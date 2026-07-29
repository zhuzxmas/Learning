#!/usr/bin/env python3
"""Quarterly stock fundamentals batch — personal-OneDrive edition.

This is the personal-OneDrive (delegated / refresh-token) rewrite of
``01.finance-batch-quarterly.py``. It removes the OneDrive-for-Business /
SharePoint (app-only) dependencies and the live kline API call (which is not
reachable from GitHub Actions / cloud IPs), replacing them with:

  * Auth + storage on the user's **personal OneDrive** via ``onedrive_personal``
    (root folder ``App/StockBatchTracker/``), proxy-aware for local Ford runs.
  * Stock universe from ``stock_list.csv`` (exported from the old SharePoint
    list) instead of a Graph SharePoint-list query.
  * Report/dividend data still fetched **live** from EastMoney's ``datacenter``
    hosts (verified reachable from cloud) via the existing ``z_Func`` helpers.
  * Price history read from pre-downloaded ``kline/{code}.txt`` files (raw
    browser JSONP) instead of calling ``push2his`` — see Phase 2 manifest tool.
  * Per-stock output written as ``output/{stock}.json`` (source of truth) plus a
    rendered ``output/{stock}.html``.

Local testing (behind the Ford proxy):
  1. Put ONEDRIVE_CLIENT_ID / TOKEN_ENC_KEY (and optionally
     ONEDRIVE_REFRESH_TOKEN) in config.cfg under an [onedrive] section, and keep
     your [proxy_add] section.
  2. ONEDRIVE_RT_READONLY defaults to 1 for local runs so the shared rt.enc is
     never rotated/desynced. Override by exporting ONEDRIVE_RT_READONLY=0.
  3. Manually place kline/{code}.txt and stock_list.csv in the OneDrive folder.
"""

import configparser
import datetime
import io
import json
import os
import random
import re
import sys
import time

# Force UTF-8 stdout/stderr so Chinese report/stock names don't crash on
# Windows consoles (cp1252) during local testing. Harmless on Linux/Actions.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

import pandas as pd

import z_Func
from onedrive_personal import OneDrivePersonal

# ---- config / proxy bootstrap --------------------------------------------
day_one = datetime.date.today()

p_cash_flow = 'CASHFLOW'
p_balance_sheet = 'BALANCE'
p_income = 'INCOMEQC'
p_income_year = 'INCOME'


def _bootstrap_local_env():
    """Locally, hydrate ONEDRIVE_* env vars + proxy from config.cfg.

    Returns the proxy address string (or None). In the cloud there is no
    config.cfg, so secrets come straight from the environment (GitHub Secrets)
    and no proxy is used.
    """
    proxy_add = None
    if not os.path.exists('./config.cfg'):
        return proxy_add  # cloud: rely on env vars + direct network

    config = configparser.ConfigParser()
    config.read(['config.cfg'])

    # Proxy: mirror the legacy behaviour (Ford box uses the proxy unless the
    # login is the special 'cindy.rao' account).
    if 'proxy_add' in config:
        try:
            login = os.getlogin()
        except Exception:  # noqa: BLE001
            login = ''
        if login != 'cindy.rao':
            proxy_add = config['proxy_add'].get('proxy_add') or None

    # Personal-OneDrive secrets from an [onedrive] section.
    if 'onedrive' in config:
        od = config['onedrive']
        for key in ('ONEDRIVE_CLIENT_ID', 'TOKEN_ENC_KEY',
                    'ONEDRIVE_REFRESH_TOKEN', 'ONEDRIVE_APP_ROOT'):
            val = od.get(key)
            if val and not os.environ.get(key):
                os.environ[key] = val

    # Default local runs to read-only token mode so we never desync the shared
    # rt.enc used by the summarizer. Explicit env var wins.
    os.environ.setdefault('ONEDRIVE_RT_READONLY', '1')
    return proxy_add


# ---- stock code -> (stock, stock_cn) --------------------------------------
def normalize_stock(code):
    """Replicate the legacy code->(stock, stock_cn) mapping.

    Ford ('F') keeps its ticker; A-shares are zero-padded to 6 digits and get a
    market suffix: 6xxxxx -> Shanghai (.ss/.SH), otherwise Shenzhen (.sz/.SZ).
    """
    code = str(code).replace(' ', '')
    if code == 'F':
        return 'F', 'F'
    # Hong Kong: 'H01548' -> strip 'H', zero-pad to 5 digits, append '.HK'.
    if code[:1] in ('H', 'h') and code[1:].isdigit():
        hk = code[1:].zfill(5) + '.HK'
        return hk, hk
    code = code.zfill(6)
    if code[0] == '6':
        return code + '.ss', code + '.SH'
    return code + '.sz', code + '.SZ'


def load_stock_list(od):
    """Read App/StockBatchTracker/stock_list.csv -> list of code strings.

    Accepts a header row containing a 'Title'/'code'/'Stock'/'stock_code'
    column, or a plain single-column list with no header.
    """
    raw = od.get_text('stock_list.csv')
    if raw is None:
        raise RuntimeError(
            "stock_list.csv not found in App/StockBatchTracker/ — export the "
            "SharePoint stock list to that file first.")
    import csv
    import io as _io
    raw = raw.lstrip('\ufeff')  # strip UTF-8 BOM if the CSV was saved with one
    rows = list(csv.reader(_io.StringIO(raw)))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        return []

    header = [c.strip().lower() for c in rows[0]]
    code_idx = 0
    data_rows = rows
    for cand in ('title', 'code', 'stock', 'stock_code', 'stock number', 'stock_number'):
        if cand in header:
            code_idx = header.index(cand)
            data_rows = rows[1:]
            break
    codes = []
    for r in data_rows:
        if code_idx < len(r):
            v = r[code_idx].strip().replace(' ', '')
            if v:
                codes.append(v)
    return codes


def find_history_name(history_names, stock, marker):
    """Return the existing history filename matching '{stock}{marker}', or None.

    marker is '-Y-' (yearly) or '-M-' (monthly). Mirrors the legacy substring
    match against the saved-files list.
    """
    prefix = stock + marker
    for name in history_names:
        if prefix in name:
            return name
    return None


# ---- per-stock report handling (yearly + monthly) -------------------------
def process_reports(od, history_names, stock, stock_cn, proxies):
    """Return (stock_output_yearly, stock_output_Seasonly_or_None, stock_name).

    Loads any cached pkl from history/, decides whether an update is due, fetches
    fresh EastMoney reports when needed, merges, and writes the pkl back. This
    preserves the merge logic from the legacy script.
    """
    stock_output_yearly = None
    stock_output_Seasonly = None
    stock_name = ''

    for check_item_name in ('yearly', 'monthly'):
        marker = '-Y-' if check_item_name == 'yearly' else '-M-'
        existing = find_history_name(history_names, stock, marker)

        if existing:
            report_from_OD = od.get_pickle('history/' + existing)
            # Parse stock name out of the filename: {stock}{marker}{name}.pkl
            try:
                tail = existing.split(marker, 1)[1]
                stock_name = tail.split('_monthly.pkl')[0].split('.pkl')[0]
            except Exception:  # noqa: BLE001
                pass

            if check_item_name == 'yearly':
                yearly_report_from_OD = report_from_OD
                latest_report_notice_date = yearly_report_from_OD.loc['Notice Date'].iloc[0]
            else:
                Seasonly_report_from_OD = report_from_OD
                latest_report_notice_date = Seasonly_report_from_OD.loc['Notice Date'].iloc[0]
            latest_report_notice_date = datetime.datetime.strptime(
                latest_report_notice_date, '%Y-%m-%d').date()

            if check_item_name == 'yearly':
                if (day_one - latest_report_notice_date).days < 365:
                    print('~~~ Yearly data in OneDrive is up to date for {}.\n'.format(stock_cn))
                    stock_output_yearly = yearly_report_from_OD
                else:
                    print(':::: Updating Yearly data for {} ...\n'.format(stock_cn))
                    url_yearly = z_Func.Year_report_url(
                        stock=stock, stock_cn=stock_cn, p_income_year=p_income_year,
                        p_cash_flow=p_cash_flow, p_balance_sheet=p_balance_sheet, day_one=day_one)
                    yearly_report_raw_out = z_Func.report_from_Eas_Mon(
                        url=url_yearly, proxies=proxies, stock_cn=stock_cn)
                    stock_output_yearly = yearly_report_raw_out[0]
                    stock_name = yearly_report_raw_out[1]

                    unique_in_report_from_OD = yearly_report_from_OD.index.difference(
                        stock_output_yearly.index).tolist()
                    df_merged = yearly_report_from_OD.copy()
                    df_merged.update(stock_output_yearly)
                    new_cols = stock_output_yearly.columns.difference(df_merged.columns)
                    if len(new_cols) > 0:
                        df_merged = pd.concat(
                            [df_merged, stock_output_yearly[new_cols].rename_axis(columns=None)],
                            axis=1)
                    sorted_cols = pd.to_datetime(df_merged.columns).sort_values(ascending=False)
                    df_final = df_merged[sorted_cols.strftime('%Y-%m-%d')]
                    df_final.loc['每股利润增长率 x 100%'] = pd.to_numeric(
                        df_final.loc['稀释后 每年/季度每股收益 元'], errors='coerce').pct_change(-1).round(2)
                    stock_output_yearly = df_final
                    _save_history(od, stock, stock_name, marker, stock_output_yearly)
            else:
                if (day_one - latest_report_notice_date).days < 40:
                    print('~~~ Seasonly data in OneDrive is up to date for {}.\n'.format(stock_cn))
                    stock_output_Seasonly = Seasonly_report_from_OD
                else:
                    print(':::: Updating Seasonly data for {} ...\n'.format(stock_cn))
                    try:
                        report_notification_date_yearly = stock_output_yearly.loc['Notice Date']
                        url_seasonly = z_Func.Seasonly_report_url(
                            report_date_yearly=report_notification_date_yearly, stock=stock,
                            stock_cn=stock_cn, p_income=p_income, p_cash_flow=p_cash_flow,
                            p_balance_sheet=p_balance_sheet)
                        Seasonly_report_raw_out = z_Func.report_from_Eas_Mon(
                            url=url_seasonly, proxies=proxies, stock_cn=stock_cn)
                        stock_output_Seasonly = Seasonly_report_raw_out[0]
                        stock_name = Seasonly_report_raw_out[1]
                        _save_history(od, stock, stock_name, marker, stock_output_Seasonly)
                    except Exception:  # noqa: BLE001
                        print('No seasonly report available as of now for {}.\n'.format(stock_cn))
        else:
            # No cached history yet — fetch fresh and save.
            print("No cached {} history for {}; fetching fresh.\n".format(check_item_name, stock_cn))
            if check_item_name == 'yearly':
                url_yearly = z_Func.Year_report_url(
                    stock=stock, stock_cn=stock_cn, p_income_year=p_income_year,
                    p_cash_flow=p_cash_flow, p_balance_sheet=p_balance_sheet, day_one=day_one)
                yearly_report_raw_out = z_Func.report_from_Eas_Mon(
                    url=url_yearly, proxies=proxies, stock_cn=stock_cn)
                stock_output_yearly = yearly_report_raw_out[0]
                stock_name = yearly_report_raw_out[1]
                _save_history(od, stock, stock_name, marker, stock_output_yearly)
            else:
                try:
                    report_notification_date_yearly = stock_output_yearly.loc['Notice Date']
                    url_seasonly = z_Func.Seasonly_report_url(
                        report_date_yearly=report_notification_date_yearly, stock=stock,
                        stock_cn=stock_cn, p_income=p_income, p_cash_flow=p_cash_flow,
                        p_balance_sheet=p_balance_sheet)
                    Seasonly_report_raw_out = z_Func.report_from_Eas_Mon(
                        url=url_seasonly, proxies=proxies, stock_cn=stock_cn)
                    stock_output_Seasonly = Seasonly_report_raw_out[0]
                    stock_name = Seasonly_report_raw_out[1]
                    _save_history(od, stock, stock_name, marker, stock_output_Seasonly)
                except Exception:  # noqa: BLE001
                    print('No seasonly report available as of now for {}.\n'.format(stock_cn))

    return stock_output_yearly, stock_output_Seasonly, stock_name


# ---- Hong Kong report handling (yearly only) ------------------------------
def process_reports_hk(od, history_names, stock, proxies):
    """HK equivalent of process_reports — yearly only, no monthly/seasonly.

    The stored pkl holds ONLY the financial rows (no 'Notice Date' row); the
    Notice Date row is (re)built each run from the manual xlsx in the batch
    layer, since HK annual reports carry no disclosure date on EastMoney.

    Returns (stock_output_yearly_or_None, stock_name, dps_map).
    """
    dps_map = {}
    stock_name = ''
    existing = find_history_name(history_names, stock, '-Y-')

    def _fetch_fresh():
        url_yearly = z_Func.Year_report_url_HK(day_one=day_one, stock_hk=stock)
        out = z_Func.report_from_Eas_Mon_HK(url=url_yearly, proxies=proxies, stock_hk=stock)
        return out[0], out[1], (out[2] if len(out) > 2 else {})

    if existing:
        cached = od.get_pickle('history/' + existing)
        try:
            stock_name = existing.split('-Y-', 1)[1].split('.pkl')[0]
        except Exception:  # noqa: BLE001
            pass
        # Freshness: newest report column within ~365 days of today.
        try:
            newest = max(cached.columns)
            newest_date = datetime.datetime.strptime(str(newest)[:10], '%Y-%m-%d').date()
            fresh = (day_one - newest_date).days < 365
        except Exception:  # noqa: BLE001
            fresh = False

        if fresh:
            print('~~~ Yearly HK data in OneDrive is up to date for {}.\n'.format(stock))
            return cached, stock_name, dps_map

        print(':::: Updating Yearly HK data for {} ...\n'.format(stock))
        fresh_df, fresh_name, dps_map = _fetch_fresh()
        if fresh_df is None:
            print('HK fetch returned no data for {}; using cached.\n'.format(stock))
            return cached, stock_name, dps_map
        stock_name = fresh_name or stock_name
        df_merged = cached.copy()
        df_merged.update(fresh_df)
        new_cols = fresh_df.columns.difference(df_merged.columns)
        if len(new_cols) > 0:
            df_merged = pd.concat([df_merged, fresh_df[new_cols]], axis=1)
        sorted_cols = pd.to_datetime(df_merged.columns).sort_values(ascending=False)
        df_final = df_merged[sorted_cols.strftime('%Y-%m-%d')]
        df_final.loc['每股利润增长率 x 100%'] = pd.to_numeric(
            df_final.loc['稀释后 每年/季度每股收益 元'], errors='coerce').pct_change(-1).round(2)
        _save_history(od, stock, stock_name, '-Y-', df_final)
        return df_final, stock_name, dps_map

    print('No cached yearly HK history for {}; fetching fresh.\n'.format(stock))
    fresh_df, stock_name, dps_map = _fetch_fresh()
    if fresh_df is None:
        return None, stock_name, dps_map
    _save_history(od, stock, stock_name, '-Y-', fresh_df)
    return fresh_df, stock_name, dps_map


def load_hk_notice_dates(od, stock, columns):
    """Build the 'Notice Date' row for an HK stock from the manual xlsx.

    Reads H{code}_Notice_Date.xlsx (columns Notice_Date + Report_Title,
    e.g. Report_Title '2024年年报'), aligns each report period column to its
    disclosure date, and returns a 1-row DataFrame indexed by 'Notice Date'.

    Returns None if the xlsx is missing (caller should skip the stock). Missing
    per-year rows fall back to the column's own period date so downstream price
    ranges still compute.
    """
    fname = 'H{}_Notice_Date.xlsx'.format(stock.split('.')[0])
    raw = od.get_bytes(fname)
    if not raw:
        print('!! {} missing — cannot build Notice Date row for {}; skipping.\n'
              .format(fname, stock))
        return None
    df_nd = pd.read_excel(io.BytesIO(raw))
    df_nd.columns = [str(c).strip() for c in df_nd.columns]
    if 'Notice_Date' not in df_nd.columns or 'Report_Title' not in df_nd.columns:
        print('!! {} lacks Notice_Date/Report_Title columns; skipping {}.\n'
              .format(fname, stock))
        return None

    year_to_notice = {}
    for _, r in df_nd.iterrows():
        m = re.search(r'(\d{4})', str(r['Report_Title']))
        if not m:
            continue
        year_to_notice[m.group(1)] = str(r['Notice_Date'])[:10]

    row = {}
    for col in columns:
        year = str(col)[:4]
        row[col] = year_to_notice.get(year, str(col)[:10])
    return pd.DataFrame([row], index=['Notice Date'])


def build_dividend_rows_hk(stock_output_yearly, dps_map, plan_records):
    """HK version of the 3 dividend rows.

      * 每股派发现金股息       = DPS_HKD (HKD; blank when None, e.g. loss-makers)
      * 每股派发股息           = PLAN_EXPLAIN text(s) matched by report year
      * 每股派发股息/每股收益 占比 = DPS_HKD / 稀释后 EPS
    Returns a 3-row DataFrame aligned to the report columns, or None if there is
    nothing to add.
    """
    cols = [c for c in stock_output_yearly.columns]
    try:
        eps = pd.to_numeric(
            stock_output_yearly.loc['稀释后 每年/季度每股收益 元'], errors='coerce')
    except Exception:  # noqa: BLE001
        eps = None

    plans_by_year = {}
    for rec in (plan_records or []):
        yr = str(rec.get('year', ''))
        if rec.get('plan'):
            plans_by_year.setdefault(yr, []).append(str(rec['plan']))

    cash, plans, ratio = {}, {}, {}
    for col in cols:
        year = str(col)[:4]
        raw = (dps_map or {}).get(col)
        if raw is None:
            raw = (dps_map or {}).get(str(col)[:10])
        try:
            if raw is not None:
                cash[col] = round(float(raw), 2)
        except (TypeError, ValueError):
            pass
        if year in plans_by_year:
            plans[col] = '; '.join(plans_by_year[year])
        if col in cash and eps is not None:
            ev = eps.get(col)
            if ev is not None and pd.notna(ev) and ev != 0:
                ratio[col] = round(cash[col] / ev, 2)

    if not cash and not plans:
        return None

    rows = pd.DataFrame(index=list(DIVIDEND_ROWS), columns=cols, dtype=object)
    for col in cols:
        rows.at['每股派发现金股息', col] = cash.get(col)
        rows.at['每股派发股息', col] = plans.get(col)
        rows.at['每股派发股息/每股收益 占比', col] = ratio.get(col)
    return rows


def _save_history(od, stock, stock_name, marker, df_data):
    if marker == '-Y-':
        name = '{}-Y-{}.pkl'.format(stock, stock_name)
    else:
        name = '{}-M-{}_monthly.pkl'.format(stock, stock_name)
    od.put_pickle('history/' + name, df_data)
    print('Saved history/{} to OneDrive.\n'.format(name))


# ---- dividend rows (per-year, summed) -------------------------------------
DIVIDEND_ROWS = ('每股派发现金股息', '每股派发股息', '每股派发股息/每股收益 占比')


def build_dividend_rows(stock_output_yearly, stock_0_dividends):
    """Return a 3-row DataFrame (aligned to the yearly report columns) holding
    the per-year dividend figures, or None if there is nothing to add.

    Rows (mirrors the legacy 01.finance-dividend-yearly.py, but *summed* when a
    report year has multiple payout records, e.g. interim + final):
      * 每股派发现金股息       = Σ PRETAX_BONUS_RMB / 10  (round 2)
      * 每股派发股息           = the IMPL_PLAN_PROFILE plan texts joined by '; '
      * 每股派发股息/每股收益 占比 = 每股派发现金股息 / 稀释后 EPS  (round 2)
    Columns without any matching payout record stay NaN.
    """
    if stock_0_dividends is None or len(stock_0_dividends) == 0:
        return None

    cols = list(stock_output_yearly.columns)
    try:
        eps = pd.to_numeric(
            stock_output_yearly.loc['稀释后 每年/季度每股收益 元'], errors='coerce')
    except Exception:  # noqa: BLE001
        eps = None

    cash, plans, ratio = {}, {}, {}
    for col in cols:
        recs = [r for r in stock_0_dividends
                if str(r.get('REPORT_DATE', '')).split(' ')[0] == col]
        if not recs:
            continue
        total_cash = 0.0
        got_cash = False
        texts = []
        for r in recs:
            raw = r.get('PRETAX_BONUS_RMB')
            try:
                total_cash += float(raw) / 10.0
                got_cash = True
            except (TypeError, ValueError):
                pass
            plan = r.get('IMPL_PLAN_PROFILE')
            if plan:
                texts.append(str(plan))
        if got_cash:
            cash[col] = round(total_cash, 2)
        if texts:
            plans[col] = '; '.join(texts)
        if got_cash and eps is not None:
            eps_val = eps.get(col)
            if eps_val is not None and pd.notna(eps_val) and eps_val != 0:
                ratio[col] = round(total_cash / eps_val, 2)

    if not cash and not plans:
        return None

    rows = pd.DataFrame(index=list(DIVIDEND_ROWS), columns=cols, dtype=object)
    for col in cols:
        rows.at['每股派发现金股息', col] = cash.get(col)
        rows.at['每股派发股息', col] = plans.get(col)
        rows.at['每股派发股息/每股收益 占比', col] = ratio.get(col)
    return rows


def apply_dividend_rows(stock_output_yearly, stock_0_dividends):
    """Merge the 3 dividend rows into the yearly DataFrame (appended at the
    bottom, overwriting any existing dividend rows). Returns the DataFrame
    (unchanged on any failure)."""
    try:
        rows = build_dividend_rows(stock_output_yearly, stock_0_dividends)
        if rows is None:
            return stock_output_yearly
        # Drop any pre-existing dividend rows so they land at the bottom in a
        # stable order, then append the freshly computed ones.
        keep = stock_output_yearly.drop(
            index=[r for r in DIVIDEND_ROWS if r in stock_output_yearly.index])
        return pd.concat([keep, rows], axis=0)
    except Exception as e:  # noqa: BLE001
        print('Dividend-row build failed; leaving yearly rows unchanged ({}: {}).\n'
              .format(type(e).__name__, e))
        return stock_output_yearly


# ---- checks (profit / liabilities / dividends) ----------------------------
def evaluate_checks(stock_output_yearly, stock_0_dividends):
    checks = {}

    profit = stock_output_yearly.loc['稀释后 每年/季度每股收益 元']
    profit_inc = stock_output_yearly.loc['每股利润增长率 x 100%']
    if any(map(lambda x: x < 0, profit)):
        checks['profit'] = (False, 'xxxxxxxxx  利润 <0,  不是 一直在增长 xxxxxxx')
    elif any(map(lambda x: x < 0, profit_inc)):
        checks['profit'] = (False, 'xxxxxxxxx  利润 下降  xxxxxxxxx')
    else:
        checks['profit'] = (True, '√√√√√√√√√√  利润  Yes  最近几年一直在增长 √√√√')

    ca_vs_l = stock_output_yearly.loc['流动资产/流动负债>2']
    if any(map(lambda x: x < 1.5, ca_vs_l)):
        checks['liabilities'] = (False, 'xxxxxxxxx 流动负债过高 xxxxxxxxx')
    else:
        checks['liabilities'] = (True, '√√√√√√√√√√  流动负债 不高 √√√√√√√√√√')

    if len(stock_0_dividends) == 0:
        checks['dividends'] = (False, 'xxxxxxxxx  公司 无 分红记录  xxxxxxxxx')
    elif len(stock_0_dividends) < 7:
        checks['dividends'] = (False, 'xxxxxxxxx  公司分红记录较少  xxxxxxxxx')
    else:
        checks['dividends'] = (True, '√√√√√√√√√√  公司分红 很多次  √√√√√√√√√√ ')
    return checks


# ---- output (JSON is source of truth; HTML rendered from it) --------------
def build_output(stock, stock_cn, stock_name, checks, stock_output_combined,
                 last_7_days, dividends_df):
    combined_json = None
    if stock_output_combined is not None:
        combined_json = json.loads(
            stock_output_combined.to_json(orient='split', force_ascii=False))
    div_records = []
    if dividends_df is not None and len(dividends_df) > 0:
        div_records = json.loads(dividends_df.to_json(orient='records', force_ascii=False))
    return {
        'stock': stock,
        'stock_cn': stock_cn,
        'stock_name': stock_name,
        'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'checks': {k: {'pass': v[0], 'text': v[1]} for k, v in checks.items()},
        'combined': combined_json,
        'last_7_days_high_low': last_7_days,
        'dividends': div_records,
    }


def merge_with_existing(od, stock_cn, payload):
    """Preserve prior good data when this run couldn't fetch part of it.

    The per-stock output/{code}.json is the source of truth, but a run may fail
    to produce some sections (e.g. kline/{code}.txt missing -> no combined table
    / price ranges, or a transient dividend-host error -> empty dividends). Rather
    than overwrite good data with nulls/empties, we merge the freshly built
    payload over whatever is already on OneDrive: any section missing in the new
    payload falls back to the stored one, flagged as carried-over.
    """
    try:
        existing_raw = od.get_text('output/{}.json'.format(stock_cn))
    except Exception:  # noqa: BLE001
        existing_raw = None
    if not existing_raw:
        return payload
    try:
        old = json.loads(existing_raw)
    except Exception:  # noqa: BLE001
        return payload

    stale = []
    if payload.get('combined') is None and old.get('combined') is not None:
        payload['combined'] = old['combined']
        stale.append('combined')
    new_l7 = payload.get('last_7_days_high_low')
    if (new_l7 is None or new_l7 == '' or new_l7 == []) and old.get('last_7_days_high_low'):
        payload['last_7_days_high_low'] = old['last_7_days_high_low']
        stale.append('last_7_days_high_low')
    if not payload.get('dividends') and old.get('dividends'):
        payload['dividends'] = old['dividends']
        stale.append('dividends')

    if stale:
        payload['carried_over'] = stale
        payload['carried_over_from'] = old.get('generated')
        print('   merged {} carried over from previous JSON for {}.\n'
              .format(', '.join(stale), stock_cn))
    return payload


def render_html(payload, stock_output_combined, dividends_df):
    stock = payload['stock']
    stock_name = payload['stock_name']
    parts = ['<!DOCTYPE html><html><head><meta charset="utf-8">',
             '<title>{} {}</title></head><body>'.format(stock, stock_name)]
    parts.append('<h2>{} {} — {}</h2>'.format(
        stock, stock_name, payload['generated']))
    for key in ('profit', 'liabilities', 'dividends'):
        c = payload['checks'].get(key)
        if c:
            parts.append('<div><p>{}: {}</p></div>'.format(key, c['text']))
    if stock_output_combined is not None:
        html_tbl = stock_output_combined.to_html().replace('<th></th>', '<th>item</th>')
        parts.append(html_tbl)
    parts.append('<div><p>Last 10 days high/low for {} {}: {}</p></div>'.format(
        stock, stock_name, payload['last_7_days_high_low']))
    if dividends_df is not None and len(dividends_df) > 0:
        show = dividends_df if len(dividends_df) < 15 else dividends_df.head(14)
        parts.append(show.to_html())
    else:
        parts.append('<div><p>No dividend record for {} {}.</p></div>'.format(stock, stock_name))
    parts.append('</body></html>')
    return ''.join(parts)


# ---- main -----------------------------------------------------------------
def main():
    proxy_add = _bootstrap_local_env()
    proxies = {"http": proxy_add, "https": proxy_add}

    od = OneDrivePersonal(proxies=proxies)

    stock_code = load_stock_list(od)
    print('Loaded {} stock codes from stock_list.csv.\n'.format(len(stock_code)))

    # Optional test filters:
    #   STOCK_ONLY=603259,000858  -> only these raw codes
    #   STOCK_LIMIT=3             -> only the first N codes
    only = os.environ.get('STOCK_ONLY', '').strip()
    if only:
        wanted = {c.strip() for c in only.split(',') if c.strip()}
        stock_code = [c for c in stock_code if str(c).strip() in wanted]
        print('STOCK_ONLY filter -> {} codes: {}\n'.format(len(stock_code), stock_code))
    limit = os.environ.get('STOCK_LIMIT', '').strip()
    if limit.isdigit():
        stock_code = stock_code[:int(limit)]
        print('STOCK_LIMIT -> first {} codes.\n'.format(limit))

    # A partial run (single/limited stocks) must NOT clobber the full summary;
    # merge its rows into the existing output/_summary.json instead of replacing.
    partial_run = bool(only) or limit.isdigit()

    history_names = [it['name'] for it in od.list_children('history') if 'file' in it]
    print('Found {} existing history files.\n'.format(len(history_names)))

    summary_rows = []

    for iii, code in enumerate(stock_code):
        stock, stock_cn = normalize_stock(code)
        print('-----Stock No.{}--- {} ({}) begin ---\n'.format(iii, stock, stock_cn))

        if stock == 'F':
            print('Ford (F) is not handled in the personal-OneDrive batch yet; skipping.\n')
            continue

        # ---- Hong Kong branch (yearly only, live price, xlsx Notice Date) ----
        if str(stock).endswith('.HK'):
            try:
                stock_output_yearly, stock_name, dps_map = process_reports_hk(
                    od, history_names, stock, proxies)
            except Exception as e:  # noqa: BLE001
                print('HK report processing failed for {} ({}: {}); skipping.\n'.format(
                    stock, type(e).__name__, e))
                continue
            if stock_output_yearly is None:
                print('No yearly HK data for {}; skipping.\n'.format(stock))
                continue

            # Notice Date row from the manual xlsx (required for price ranges).
            notice_row = load_hk_notice_dates(od, stock, list(stock_output_yearly.columns))
            if notice_row is None:
                continue  # xlsx missing -> skip this stock (warning already printed)
            # Drop any stale Notice Date row, then prepend the fresh one on top.
            if 'Notice Date' in stock_output_yearly.index:
                stock_output_yearly = stock_output_yearly.drop(index='Notice Date')
            stock_output_yearly = pd.concat([notice_row, stock_output_yearly], axis=0)

            # HK dividends: textual plans + DPS-based numeric rows.
            plan_records = z_Func.Dividend_Data_Yearly_from_Eas_Mon_HK(stock, proxies)
            div_rows = build_dividend_rows_hk(stock_output_yearly, dps_map, plan_records)
            if div_rows is not None:
                keep = stock_output_yearly.drop(
                    index=[r for r in DIVIDEND_ROWS if r in stock_output_yearly.index])
                stock_output_yearly = pd.concat([keep, div_rows], axis=0)
            try:
                _save_history(od, stock, stock_name, '-Y-', stock_output_yearly)
            except Exception as e:  # noqa: BLE001
                print('Re-saving HK yearly failed for {} ({}: {}).\n'.format(
                    stock, type(e).__name__, e))

            dividends_df = None
            if plan_records:
                dividends_df = pd.DataFrame(plan_records)

            # Live HK price fetch -> yearly price ranges.
            stock_output_combined = stock_output_yearly
            last_7_days = None
            try:
                stock_price_df = z_Func.get_stock_price_Raw_Data_EasMon_HK(
                    stock, proxies, limit_number='2000')
            except Exception as e:  # noqa: BLE001
                print('HK price fetch failed for {} ({}); no price ranges.\n'.format(stock, e))
                stock_price_df = pd.DataFrame()
            if len(stock_price_df) > 0:
                try:
                    stock_price_yearly = z_Func.get_stock_price_range_Based_on_EasMon(
                        stock_price_df=stock_price_df, stock_output=stock_output_yearly,
                        day_one=day_one)
                    stock_output_combined = pd.concat(
                        [stock_output_yearly, stock_price_yearly], axis=0)
                except Exception as e:  # noqa: BLE001
                    print('HK price-range build failed for {} ({}).\n'.format(stock, e))
                try:
                    last_7_days = z_Func.get_latest_7_days_stock_price_Based_on_EasMon(
                        stock_price_df=stock_price_df, proxy_add=proxy_add)
                except Exception:  # noqa: BLE001
                    last_7_days = None

            checks = evaluate_checks(stock_output_yearly, plan_records or [])
            summary_rows.append([
                '{}--{}-{}'.format(iii, stock, stock_name),
                str(checks['profit'][0]), str(checks['liabilities'][0]),
                str(checks['dividends'][0])])

            payload = build_output(stock, stock_cn, stock_name, checks,
                                   stock_output_combined, last_7_days, dividends_df)
            payload = merge_with_existing(od, stock_cn, payload)
            od.put_text('output/{}.json'.format(stock_cn),
                        json.dumps(payload, ensure_ascii=False, indent=2),
                        content_type='application/json; charset=utf-8')
            html = render_html(payload, stock_output_combined, dividends_df)
            od.put_text('output/{}.html'.format(stock_cn), html,
                        content_type='text/html; charset=utf-8')
            print('Wrote output/{}.json + .html\n'.format(stock_cn))
            time.sleep(random.uniform(7, 13))
            continue

        try:
            stock_output_yearly, stock_output_Seasonly, stock_name = process_reports(
                od, history_names, stock, stock_cn, proxies)
        except Exception as e:  # noqa: BLE001
            print('Report processing failed for {} ({}: {}); skipping.\n'.format(
                stock_cn, type(e).__name__, e))
            continue

        if stock_output_yearly is None:
            print('No yearly data for {}; skipping.\n'.format(stock_cn))
            continue

        # --- dividends (live datacenter host) ---
        # Fetched up front so the per-year dividend rows can be merged into the
        # yearly report (and re-saved) before it feeds the kline concat / output.
        try:
            stock_0_dividends = z_Func.Dividend_Data_Yearly_from_Eas_Mon(stock_cn, proxies)
        except Exception as e:  # noqa: BLE001
            print('Dividend fetch failed for {} ({}); treating as none.\n'.format(stock_cn, e))
            stock_0_dividends = []

        # Recompute the 3 dividend rows every run (all years) and persist them.
        updated_yearly = apply_dividend_rows(stock_output_yearly, stock_0_dividends)
        if updated_yearly is not stock_output_yearly:
            stock_output_yearly = updated_yearly
            try:
                _save_history(od, stock, stock_name, '-Y-', stock_output_yearly)
            except Exception as e:  # noqa: BLE001
                print('Re-saving yearly with dividend rows failed for {} ({}: {}).\n'
                      .format(stock_cn, type(e).__name__, e))

        dividends_df = None
        if len(stock_0_dividends) > 0:
            dividends_df = pd.DataFrame(stock_0_dividends)[
                ['REPORT_DATE', 'EQUITY_RECORD_DATE', 'IMPL_PLAN_PROFILE']]

        # --- price history from the manually-downloaded kline file ---
        kline_text = od.get_text('kline/{}.txt'.format(stock_cn))
        if kline_text is None:
            print('!! kline/{}.txt missing — run the kline manifest pre-step. '
                  'Skipping price ranges for this stock.\n'.format(stock_cn))
        stock_price_df = z_Func.get_stock_price_from_kline_text(kline_text or '', stock_cn=stock_cn)

        stock_output_combined = None
        last_7_days = None
        if len(stock_price_df) > 0:
            stock_price_yearly = z_Func.get_stock_price_range_Based_on_EasMon(
                stock_price_df=stock_price_df, stock_output=stock_output_yearly, day_one=day_one)
            stock_output_yearly_f = pd.concat([stock_output_yearly, stock_price_yearly], axis=0)
            try:
                stock_price_Seasonly = z_Func.get_stock_price_range_Based_on_EasMon(
                    stock_price_df=stock_price_df, stock_output=stock_output_Seasonly, day_one=day_one)
                stock_output_Seasonly_f = pd.concat(
                    [stock_output_Seasonly, stock_price_Seasonly], axis=0)
                stock_output_combined = pd.concat(
                    [stock_output_Seasonly_f, stock_output_yearly_f], axis=1)
            except Exception:  # noqa: BLE001
                stock_output_combined = pd.concat([stock_output_yearly_f], axis=1)
            last_7_days = z_Func.get_latest_7_days_stock_price_Based_on_EasMon(
                stock_price_df=stock_price_df, proxy_add=proxy_add)
        else:
            stock_output_combined = stock_output_yearly

        checks = evaluate_checks(stock_output_yearly, stock_0_dividends)
        summary_rows.append([
            '{}--{}-{}'.format(iii, stock, stock_name),
            str(checks['profit'][0]), str(checks['liabilities'][0]),
            str(checks['dividends'][0])])

        payload = build_output(stock, stock_cn, stock_name, checks,
                               stock_output_combined, last_7_days, dividends_df)
        payload = merge_with_existing(od, stock_cn, payload)
        od.put_text('output/{}.json'.format(stock_cn),
                    json.dumps(payload, ensure_ascii=False, indent=2),
                    content_type='application/json; charset=utf-8')
        html = render_html(payload, stock_output_combined, dividends_df)
        od.put_text('output/{}.html'.format(stock_cn), html,
                    content_type='text/html; charset=utf-8')
        print('Wrote output/{}.json + .html\n'.format(stock_cn))

        time.sleep(random.uniform(7, 13))

    # --- summary ---
    summary_cols = ['Stock Number', '利润表现好', '流动负债不高', '分红多']

    def _summary_key(row):
        # 'Stock Number' looks like '{iii}--{stock}-{name}', stock e.g. 600875.ss
        sn = str(row.get('Stock Number', '') if isinstance(row, dict) else row[0])
        return sn.split('--', 1)[-1].split('-', 1)[0]

    new_rows = [dict(zip(summary_cols, r)) for r in summary_rows]

    if partial_run:
        # Merge: keep existing rows for stocks we did NOT touch this run, then
        # add the freshly computed ones (so a single-stock update no longer
        # wipes the whole summary).
        existing = od.get_bytes('output/_summary.json')
        kept = []
        if existing:
            try:
                touched = {_summary_key(r) for r in new_rows}
                for r in json.loads(existing.decode('utf-8')):
                    if _summary_key(r) not in touched:
                        kept.append(r)
            except Exception as e:  # noqa: BLE001
                print('WARN: could not merge existing _summary.json ({}); '
                      'writing only this run\'s rows.\n'.format(e))
        merged = kept + new_rows
        summary_df = pd.DataFrame(merged, columns=summary_cols)
    else:
        summary_df = pd.DataFrame(summary_rows, columns=summary_cols)

    if len(summary_df) > 0:
        summary_df = summary_df.sort_values(
            by=['利润表现好', '流动负债不高', '分红多'], ascending=False)
    od.put_text('output/_summary.json',
                summary_df.to_json(orient='records', force_ascii=False),
                content_type='application/json; charset=utf-8')
    summary_html = ('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'
                    'Summary {}</title></head><body>{}</body></html>').format(
        day_one.strftime('%Y-%m-%d'),
        summary_df.to_html().replace('<th></th>', '<th>item</th>'))
    od.put_text('output/_summary.html', summary_html,
                content_type='text/html; charset=utf-8')
    print('Task Completed Successfully! Wrote output/_summary.json + .html\n')


if __name__ == '__main__':
    main()
