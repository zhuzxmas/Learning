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
import json
import os
import random
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


def _save_history(od, stock, stock_name, marker, df_data):
    if marker == '-Y-':
        name = '{}-Y-{}.pkl'.format(stock, stock_name)
    else:
        name = '{}-M-{}_monthly.pkl'.format(stock, stock_name)
    od.put_pickle('history/' + name, df_data)
    print('Saved history/{} to OneDrive.\n'.format(name))


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

        # --- dividends (live datacenter host) ---
        try:
            stock_0_dividends = z_Func.Dividend_Data_Yearly_from_Eas_Mon(stock_cn, proxies)
        except Exception as e:  # noqa: BLE001
            print('Dividend fetch failed for {} ({}); treating as none.\n'.format(stock_cn, e))
            stock_0_dividends = []

        dividends_df = None
        if len(stock_0_dividends) > 0:
            dividends_df = pd.DataFrame(stock_0_dividends)[
                ['REPORT_DATE', 'EQUITY_RECORD_DATE', 'IMPL_PLAN_PROFILE']]

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
