#!/usr/bin/env python3
"""Quarterly stock fundamentals batch — personal-OneDrive edition.

This is the personal-OneDrive (delegated / refresh-token) rewrite of
``01.finance-batch-quarterly.py``. It removes the OneDrive-for-Business /
SharePoint (app-only) dependencies and the live kline API call (which is not
reachable from GitHub Actions / cloud IPs), replacing them with:

  * Auth + storage on the user's **personal OneDrive** via ``onedrive_personal``
    (root folder ``Apps/StockBatchTracker/``), proxy-aware for local Ford runs.
  * Stock universe from ``stock_list.csv`` (exported from the old SharePoint
    list) instead of a Graph SharePoint-list query.
  * Report/dividend data still fetched **live** from EastMoney's ``datacenter``
    hosts (verified reachable from cloud) via the existing ``z_Func`` helpers.
  * Unadjusted Tencent price history cached under ``history/``: first run seeds
    2018-present; nightly runs merge only the latest 300 trading days.
  * Per-stock output written as ``output/{stock}.json`` (source of truth).

Local testing (behind the Ford proxy):
  1. Put ONEDRIVE_CLIENT_ID / TOKEN_ENC_KEY (and optionally
     ONEDRIVE_REFRESH_TOKEN) in config.cfg under an [onedrive] section, and keep
     your [proxy_add] section.
  2. ONEDRIVE_RT_READONLY defaults to 1 for local runs so the shared rt.enc is
     never rotated/desynced. Override by exporting ONEDRIVE_RT_READONLY=0.
  3. Keep stock_list.csv in the OneDrive folder; Tencent prices are automatic.
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
import valuation_engine
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
    """Read Apps/StockBatchTracker/stock_list.csv -> list of code strings.

    Accepts a header row containing a 'Title'/'code'/'Stock'/'stock_code'
    column, or a plain single-column list with no header.
    """
    raw = od.get_text('stock_list.csv')
    if raw is None:
        raise RuntimeError(
            "stock_list.csv not found in Apps/StockBatchTracker/ — export the "
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
def process_reports(od, history_names, stock, stock_cn, proxies, skip_fetch=False,
                    force_refresh=False):
    """Return (stock_output_yearly, stock_output_Seasonly_or_None, stock_name).

    Loads any cached pkl from history/, decides whether an update is due, fetches
    fresh EastMoney reports when needed, merges, and writes the pkl back. This
    preserves the merge logic from the legacy script.

    skip_fetch=True (LIGHT_MODE): never hit the network — always serve the cached
    pkl as-is (so the daily price+chip run stays fast and does not re-fetch
    financials every day during a quarter's disclosure gap). If no pkl exists the
    yearly result is None and the caller skips the stock.
    """
    stock_output_yearly = None
    stock_output_Seasonly = None
    stock_name = ''
    report_fetch_ok = True

    has_report_cache = all(find_history_name(history_names, stock, marker)
                           for marker in ('-Y-', '-M-'))
    refresh_kinds, probe_key = report_refresh_decision(
        od, stock_cn, 'A', has_report_cache, proxies,
        light_mode=skip_fetch, force_refresh=force_refresh)

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
                if skip_fetch or 'yearly' not in refresh_kinds:
                    if skip_fetch:
                        print('LIGHT_MODE: serving cached Yearly data for {}.\n'.format(stock_cn))
                    else:
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

                    # Fresh data wins while retaining old metrics/dividend rows;
                    # combine_first also adds brand-new rows and columns.
                    df_merged = stock_output_yearly.combine_first(yearly_report_from_OD)
                    sorted_cols = pd.to_datetime(df_merged.columns).sort_values(ascending=False)
                    df_final = df_merged[sorted_cols.strftime('%Y-%m-%d')]
                    df_final.loc['每股利润增长率 x 100%'] = pd.to_numeric(
                        df_final.loc['稀释后 每年/季度每股收益 元'],
                        errors='coerce').pct_change(-1, fill_method=None).round(2)
                    stock_output_yearly = df_final
                    if not stock_output_yearly.equals(yearly_report_from_OD):
                        _save_history(od, stock, stock_name, marker, stock_output_yearly)
                    else:
                        print('Yearly report content unchanged for {}; not writing pkl.\n'.format(
                            stock_cn))
            else:
                if skip_fetch or 'monthly' not in refresh_kinds:
                    if skip_fetch:
                        print('LIGHT_MODE: serving cached Seasonly data for {}.\n'.format(stock_cn))
                    else:
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
                        if not stock_output_Seasonly.equals(Seasonly_report_from_OD):
                            _save_history(od, stock, stock_name, marker, stock_output_Seasonly)
                        else:
                            print('Seasonly report content unchanged for {}; not writing pkl.\n'.format(
                                stock_cn))
                    except Exception as e:  # noqa: BLE001
                        report_fetch_ok = False
                        stock_output_Seasonly = Seasonly_report_from_OD
                        print('Seasonly refresh failed for {} ({}); keeping cache.\n'.format(
                            stock_cn, e))
        else:
            # No cached history yet.
            if skip_fetch:
                print('LIGHT_MODE: no cached {} history for {}; skipping fetch '
                      '(will populate on the next full run).\n'.format(check_item_name, stock_cn))
                continue
            # Fetch fresh and save.
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
                except Exception as e:  # noqa: BLE001
                    report_fetch_ok = False
                    print('No seasonly report available as of now for {} ({}).\n'.format(
                        stock_cn, e))

    if refresh_kinds and report_fetch_ok and stock_output_yearly is not None:
        mark_report_full_check(
            od, stock_cn, 'A', probe_key,
            full_validation=refresh_kinds == {'yearly', 'monthly'})
    return stock_output_yearly, stock_output_Seasonly, stock_name


# ---- Hong Kong report handling (yearly only) ------------------------------
def _recompute_growth_hk(df):
    """Recompute the '每股利润增长率 x 100%' row *within* a frame whose columns
    are all the same report type (so pct_change compares like-for-like periods).
    Mutates and returns df. No-op if the EPS row is absent."""
    if df is None or '稀释后 每年/季度每股收益 元' not in df.index:
        return df
    df.loc['每股利润增长率 x 100%'] = pd.to_numeric(
        df.loc['稀释后 每年/季度每股收益 元'], errors='coerce').pct_change(-1, fill_method=None).round(2)
    return df


def _split_hk_periods(df):
    """Split an HK combined frame into (yearly, seasonly) by column date suffix:
    '-12-31' columns are annual; everything else (06-30 interim, 03-31/09-30
    quarterly) is seasonly. Each side's columns stay date-desc sorted. Returns
    (None, None) parts when a side has no columns."""
    if df is None or df.shape[1] == 0:
        return None, None
    annual_cols = []
    if '估值_年报标记' in df.index:
        annual_cols = [c for c in df.columns
                       if pd.to_numeric(df.loc['估值_年报标记', c], errors='coerce') == 1]
    if not annual_cols:
        annual_cols = [c for c in df.columns if str(c).endswith('-12-31')]
    season_cols = [c for c in df.columns if c not in annual_cols]

    def _pick(cols):
        if not cols:
            return None
        ordered = pd.to_datetime(cols).sort_values(ascending=False).strftime('%Y-%m-%d')
        sub = df[list(ordered)].copy()
        return _recompute_growth_hk(sub)

    return _pick(annual_cols), _pick(season_cols)


def _hk_display_interim(yearly_df, seasonly_df):
    """展示层过滤：中期/季度侧只保留最新年报之后的那一期 06-30 半年报。
    丢弃 03-31/09-30 及更早的 06-30。无符合项返回 None。pkl 缓存不受影响。"""
    if seasonly_df is None or seasonly_df.shape[1] == 0:
        return None
    interim_cols = [c for c in seasonly_df.columns if str(c).endswith('-06-30')]
    if not interim_cols:
        return None
    latest = pd.to_datetime(interim_cols).max()
    if yearly_df is not None and yearly_df.shape[1] > 0:
        latest_annual = pd.to_datetime(list(yearly_df.columns)).max()
        if latest <= latest_annual:   # 半年报未领先于最新年报 -> 不显示
            return None
    col = latest.strftime('%Y-%m-%d')
    return _recompute_growth_hk(seasonly_df[[col]].copy())


DISPLAY_MIN_YEAR = 2018


def _filter_display_years(df, min_year=DISPLAY_MIN_YEAR):
    """展示层：财务指标表只保留报告期年份 >= min_year 的列（含 2018）。
    列名非日期或无法解析年份的列一律保留（稳妥），行不受影响。
    A股/港股通用。原始 pkl 不受影响。"""
    if df is None or df.shape[1] == 0:
        return df
    keep = []
    for c in df.columns:
        s = str(c)
        # 期望形如 'YYYY-MM-DD'；非日期形态或解析失败的列保留，避免误删。
        if len(s) >= 5 and s[4:5] == '-':
            try:
                yr = int(s[:4])
            except (ValueError, TypeError):
                keep.append(c)
                continue
            if yr >= min_year:
                keep.append(c)
        else:
            keep.append(c)
    if not keep:
        return df            # 全被过滤则退回原样，避免产出空表
    return df[keep]


PRICE_RANGE_ROW_LABEL = '后一年股价范围'


def _reorder_hk_tail(df):
    """Deterministically place the price-range row *before* the dividend rows at
    the bottom of the table, matching the A-share combined layout (财务指标 →
    后一年股价范围 → 分红行). All other rows keep their order. Safe no-op when the
    rows are absent."""
    if df is None:
        return df
    idx = list(df.index)
    tail = []
    for label in [PRICE_RANGE_ROW_LABEL] + list(DIVIDEND_ROWS):
        if label in idx:
            tail.append(label)
            idx.remove(label)
    if not tail:
        return df
    return df.reindex(idx + tail)


def process_reports_hk(od, history_names, stock, proxies, skip_fetch=False,
                       force_refresh=False):
    """HK equivalent of process_reports.

    skip_fetch=True (LIGHT_MODE): never hit the network — serve the cached pkl
    as-is (keeps the daily price+chip run fast). If no pkl exists, return
    (None, None, name, {}) so the caller skips the stock this run.

    Fetches *all* disclosed periods (annual 12-31 + interim 06-30 + quarterly
    03-31/09-30 where reported) in one call, caches the full mixed frame, then
    splits it into annual vs interim/quarterly so the batch can lay them out
    side by side like A-shares (季度 + 年报).

    The stored pkl holds ONLY the financial rows (no 'Notice Date' row); the
    Notice Date row is (re)built each run from the manual xlsx in the batch
    layer, since HK reports carry no disclosure date on EastMoney.

    Returns (stock_output_yearly_or_None, stock_output_seasonly_or_None,
             stock_name, dps_map).
    """
    dps_map = {}
    stock_name = ''
    existing = find_history_name(history_names, stock, '-Y-')
    needs_full_fetch, probe_key = report_refresh_decision(
        od, stock, 'HK', bool(existing), proxies,
        light_mode=skip_fetch, force_refresh=force_refresh)

    def _fetch_fresh():
        url_yearly = z_Func.Year_report_url_HK(day_one=day_one, stock_hk=stock)
        out = z_Func.report_from_Eas_Mon_HK(url=url_yearly, proxies=proxies, stock_hk=stock)
        return out[0], out[1], (out[2] if len(out) > 2 else {})

    def _finish(full_df):
        """Split the full mixed frame and return the 4-tuple."""
        yearly_df, seasonly_df = _split_hk_periods(full_df)
        return yearly_df, seasonly_df, stock_name, dps_map

    if existing:
        cached = od.get_pickle('history/' + existing)
        try:
            stock_name = existing.split('-Y-', 1)[1].split('.pkl')[0]
        except Exception:  # noqa: BLE001
            pass
        # LIGHT_MODE: never fetch — always serve the cached frame.
        if skip_fetch:
            print('LIGHT_MODE: serving cached HK data for {}.\n'.format(stock))
            return _finish(cached)

        if not needs_full_fetch:
            print('~~~ HK data in OneDrive is up to date for {}.\n'.format(stock))
            return _finish(cached)

        print(':::: Updating HK data for {} ...\n'.format(stock))
        fresh_df, fresh_name, dps_map = _fetch_fresh()
        if fresh_df is None:
            print('HK fetch returned no data for {}; using cached.\n'.format(stock))
            return _finish(cached)
        stock_name = fresh_name or stock_name
        df_merged = cached.copy()
        df_merged.update(fresh_df)
        new_cols = fresh_df.columns.difference(df_merged.columns)
        if len(new_cols) > 0:
            df_merged = pd.concat([df_merged, fresh_df[new_cols]], axis=1)
        sorted_cols = pd.to_datetime(df_merged.columns).sort_values(ascending=False)
        df_final = df_merged[sorted_cols.strftime('%Y-%m-%d')]
        _save_history(od, stock, stock_name, '-Y-', df_final)
        mark_report_full_check(od, stock, 'HK', probe_key)
        return _finish(df_final)

    if skip_fetch:
        print('LIGHT_MODE: no cached HK history for {}; skipping fetch '
              '(will populate on the next full run).\n'.format(stock))
        return None, None, stock_name, dps_map
    print('No cached HK history for {}; fetching fresh.\n'.format(stock))
    fresh_df, stock_name, dps_map = _fetch_fresh()
    if fresh_df is None:
        return None, None, stock_name, dps_map
    _save_history(od, stock, stock_name, '-Y-', fresh_df)
    mark_report_full_check(od, stock, 'HK', probe_key)
    return _finish(fresh_df)


def _hk_notice_report_kind(title):
    """Classify an HK notice title for precise same-year matching."""
    text = str(title or '').strip().lower()
    if re.search(r'中报|半年|中期|interim|half[- ]?year', text):
        return 'interim'
    if re.search(r'年报|年度|annual', text):
        return 'annual'
    if re.search(r'一季|第一季|q1|first quarter', text):
        return 'q1'
    if re.search(r'三季|第三季|q3|third quarter', text):
        return 'q3'
    return None


def load_hk_notice_dates(od, stock, columns, report_kind=None, raw=None,
                         raw_preloaded=False):
    """Build the 'Notice Date' row for an HK stock from the manual xlsx.

    Reads H{code}_Notice_Date.xlsx (columns Notice_Date + Report_Title,
    e.g. Report_Title '2024年年报' / '2024年中报'), aligns each report period
    using year + report type, and returns a 1-row DataFrame indexed by
    'Notice Date'. This prevents a same-year interim row from overwriting the
    annual row (or vice versa).

    Never returns None: if the xlsx is missing or malformed, falls back to using
    each column's own period date so the stock is still processed (price ranges
    just use fiscal period-end instead of disclosure date). A warning is printed
    so the operator knows to upload the xlsx for precise dates.
    """
    def _fallback():
        return pd.DataFrame(
            [{col: str(col)[:10] for col in columns}], index=['Notice Date'])

    fname = 'H{}_Notice_Date.xlsx'.format(stock.split('.')[0])
    if not raw_preloaded:
        raw = od.get_bytes(fname)
    if not raw:
        print('!! {} missing — 使用期末日期作为 Notice Date（上传该文件可获得精确披露日）：{}。\n'
              .format(fname, stock))
        return _fallback()
    df_nd = pd.read_excel(io.BytesIO(raw))
    df_nd.columns = [str(c).strip() for c in df_nd.columns]
    if 'Notice_Date' not in df_nd.columns or 'Report_Title' not in df_nd.columns:
        print('!! {} lacks Notice_Date/Report_Title columns — 使用期末日期作为 Notice Date：{}。\n'
              .format(fname, stock))
        return _fallback()

    typed_notice = {}
    generic_notice = {}
    for _, r in df_nd.iterrows():
        title = str(r['Report_Title'])
        m = re.search(r'(\d{4})', title)
        if not m:
            continue
        raw_date = r['Notice_Date']
        try:
            notice = pd.to_datetime(raw_date).strftime('%Y-%m-%d')
        except Exception:  # noqa: BLE001
            notice = str(raw_date)[:10]
        kind = _hk_notice_report_kind(title)
        if kind:
            typed_notice[(m.group(1), kind)] = notice
        else:
            # Backward-compatible row such as title='2024'; use only when no
            # type-specific date exists, never as the opposite report type.
            generic_notice[m.group(1)] = notice

    row = {}
    for col in columns:
        year = str(col)[:4]
        row[col] = (typed_notice.get((year, report_kind))
                    or generic_notice.get(year)
                    or str(col)[:10])
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
    amt_by_year = {}
    for rec in (plan_records or []):
        yr = str(rec.get('year', ''))
        if rec.get('plan'):
            plans_by_year.setdefault(yr, []).append(str(rec['plan']))
        amt = rec.get('amount')
        if amt is not None:
            try:
                amt_by_year[yr] = round(amt_by_year.get(yr, 0.0) + float(amt), 4)
            except (TypeError, ValueError):
                pass
    if amt_by_year:
        print('HK cash-div by fiscal year: {}'.format(amt_by_year))

    cash, plans, ratio = {}, {}, {}
    for col in cols:
        year = str(col)[:4]
        # Prefer the summed per-fiscal-year cash parsed from PLAN_EXPLAIN
        # (interim + final); fall back to the annual DPS_HKD when a year has
        # no parsed amount.
        if year in amt_by_year:
            cash[col] = round(amt_by_year[year], 2)
        else:
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
        # Match by fiscal *year*, not exact report date: interim payouts carry
        # REPORT_DATE YYYY-06-30 while the yearly column is YYYY-12-31, so an
        # exact match would silently drop mid-year dividends. Grouping by year
        # lets interim + final be summed together below.
        year = str(col)[:4]
        recs = [r for r in stock_0_dividends
                if str(r.get('REPORT_DATE', '')).split(' ')[0][:4] == year]
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
def evaluate_profit_check(stock_output_yearly, max_years=5,
                          min_growth=-0.03):
    """Evaluate recent annual EPS stability using unrounded EPS values.

    Uses the latest `max_years` annual columns (normally already newest-first).
    EPS must be non-negative. Adjacent-year comparisons pass when growth is at
    least -3%; missing values or a zero prior-year EPS are not computable and
    are skipped rather than implicitly filled.
    """
    eps = pd.to_numeric(
        stock_output_yearly.loc['稀释后 每年/季度每股收益 元'],
        errors='coerce')
    try:
        ordered = sorted(eps.index, key=lambda c: pd.to_datetime(str(c)),
                         reverse=True)
        eps = eps.reindex(ordered)
    except Exception:  # noqa: BLE001
        pass
    eps = eps.iloc[:max_years]
    years_used = len(eps)

    if (eps.dropna() < 0).any():
        return (False, 'xxxxxxxxx  最近{}年存在年度EPS<0  xxxxxxxxx'.format(
            years_used))

    growth_values = []
    for i in range(max(0, len(eps) - 1)):
        current = eps.iloc[i]
        previous = eps.iloc[i + 1]
        if pd.isna(current) or pd.isna(previous) or previous == 0:
            continue
        growth_values.append(float(current / previous - 1.0))

    if any(g < min_growth - 1e-12 for g in growth_values):
        return (False,
                'xxxxxxxxx  最近{}年存在年度EPS同比降幅超过3%  xxxxxxxxx'.format(
                    years_used))

    return (True,
            '√√√√  最近{}年年度EPS均非负，且可计算同比降幅不超过3%（{}组可计算） √√√√'.format(
                years_used, len(growth_values)))


def evaluate_checks(stock_output_yearly, stock_0_dividends):
    checks = {}

    checks['profit'] = evaluate_profit_check(stock_output_yearly)

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


# ---- output (JSON is the sole source of truth) -----------------------------
def build_output(stock, stock_cn, stock_name, checks, stock_output_combined,
                 last_7_days, dividends_df, chip_distribution=None,
                 price_source_error=False, valuation=None):
    stock_output_combined = _filter_display_years(stock_output_combined)
    combined_json = None
    if stock_output_combined is not None:
        stock_output_combined = stock_output_combined.drop(
            index=[label for label in stock_output_combined.index
                   if str(label).startswith('估值_')], errors='ignore')
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
        'chip_distribution': chip_distribution,
        'price_source_error': bool(price_source_error),
        'valuation': valuation,
    }


VALUATION_ROWS = {
    'cash': '估值_现金 亿元', 'securities': '估值_有价证券 亿元',
    'receivables': '估值_应收款项 亿元', 'inventory': '估值_存货 亿元',
    'fixed_assets': '估值_固定资产 亿元', 'intangibles': '估值_无形资产 亿元',
    'goodwill': '估值_商誉 亿元', 'total_liabilities': '估值_总负债 亿元',
    'interest_bearing_debt': '估值_有息负债 亿元',
    'minority_interest': '估值_少数股东权益 亿元',
    'pretax_profit': '估值_税前利润 亿元', 'income_tax': '估值_所得税费用 亿元',
    'depreciation_amortization': '估值_折旧摊销 亿元',
    'capital_expenditure': '估值_资本开支 亿元',
    'total_assets': '总资产 亿元', 'revenue': '营业总收入 销售额 亿元',
    'ebit': '估值_息税前利润 亿元',
}


def _valuation_period(frame, column):
    row = {'date': str(column)[:10]}
    for key, label in VALUATION_ROWS.items():
        value = None
        if label in frame.index:
            value = pd.to_numeric(frame.loc[label, column], errors='coerce')
        row[key] = None if pd.isna(value) else float(value) * 100000000
    shares_million = None
    if '普通股数量 百万' in frame.index:
        shares_million = pd.to_numeric(frame.loc['普通股数量 百万', column], errors='coerce')
    row['shares'] = None if pd.isna(shares_million) else float(shares_million) * 1000000
    return row


def build_valuation(stock_output_yearly, quote=None, assumptions=None, stock_name=None,
                    stock_output_interim=None):
    """Build an auditable valuation object from newest-first annual reports."""
    if stock_output_yearly is None or len(stock_output_yearly.columns) == 0:
        return None
    if not any(label in stock_output_yearly.index for label in VALUATION_ROWS.values()):
        return None
    quote = quote or {}
    columns = sorted(stock_output_yearly.columns, key=lambda value: str(value), reverse=True)[:7]
    periods = [_valuation_period(stock_output_yearly, column) for column in columns]
    snapshot = periods[0]
    snapshot_type = 'annual'
    if stock_output_interim is not None and stock_output_interim.shape[1] > 0:
        interim_columns = [column for column in stock_output_interim.columns
                           if str(column).endswith('-06-30') and str(column) > str(columns[0])]
        if interim_columns:
            interim_column = sorted(interim_columns, key=lambda value: str(value), reverse=True)[0]
            snapshot = _valuation_period(stock_output_interim, interim_column)
            snapshot_type = 'interim'
    if quote.get('total_shares') and periods:
        snapshot['shares'] = quote['total_shares']
    org_type = None
    if '估值_金融企业标记' in stock_output_yearly.index:
        marker = pd.to_numeric(stock_output_yearly.loc['估值_金融企业标记', columns[0]], errors='coerce')
        if not pd.isna(marker) and marker == 1:
            org_type = '金融企业'
    if any(word in str(stock_name or '') for word in ('银行', '保险', '证券')):
        org_type = '金融企业'
    result = valuation_engine.calculate(
        periods, assumptions=assumptions, industry=quote.get('industry'), org_type=org_type,
        current_price=quote.get('current_price'),
        currency=quote.get('currency', 'CNY'), snapshot=snapshot)
    result['raw_periods'] = periods
    result['snapshot'] = snapshot
    result['snapshot_type'] = snapshot_type
    result['quote'] = quote
    result['model'] = 'graham-greenwald-av-epv-v1'
    return result


def latest_price_quote(stock_price_df, currency):
    if stock_price_df is None or len(stock_price_df) == 0:
        return {'currency': currency}
    row = stock_price_df.sort_values('日期').iloc[-1]
    price = pd.to_numeric(row.get('收盘'), errors='coerce')
    date = row.get('日期')
    return {
        'currency': currency,
        'current_price': None if pd.isna(price) else float(price),
        'as_of': (date.isoformat() if hasattr(date, 'isoformat') else str(date)[:10]),
        'source': 'Tencent',
    }


def refresh_previous_valuation(old_output, quote):
    """Reuse complete report valuation in light mode while refreshing price."""
    previous = (old_output or {}).get('valuation')
    if not isinstance(previous, dict):
        return None
    result = json.loads(json.dumps(previous))
    if quote.get('current_price') is None:
        return result
    result['quote'] = quote
    comparison = result.get('comparison')
    price = quote.get('current_price')
    if isinstance(comparison, dict) and price is not None:
        comparison['current_price'] = price
        for key, section in (('asset_margin_of_safety', result.get('asset_value')),
                             ('epv_margin_of_safety', result.get('epv'))):
            value = section and section.get('per_share')
            comparison[key] = (round(1 - price / value, 6)
                               if value is not None and value > 0 else None)
    return result


def load_existing_output(od, stock_cn):
    """Load and parse output/{code}.json once, returning None on failure."""
    try:
        raw = od.get_text('output/{}.json'.format(stock_cn))
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


DIVIDEND_CACHE_DAYS = 21
REPORT_PROBE_DAYS = 14
REPORT_FULL_CHECK_DAYS = 28


def load_dividend_records(od, stock_cn, fetcher, light_mode=False,
                          force_refresh=False):
    """Return (records, cache_available) using a 21-day per-stock cache.

    Light mode never calls the upstream host. Full runs refresh only when the
    cache is absent/expired (or FORCE_DIVIDEND_REFRESH=1). A failed refresh uses
    stale cached records and never overwrites them with an error result.
    """
    cache_path = 'history/{}-D-EastMoney.pkl'.format(stock_cn)
    try:
        cached = od.get_pickle(cache_path)
    except Exception as e:  # noqa: BLE001
        print('WARN: dividend cache read failed for {} ({}).\n'.format(stock_cn, e))
        cached = None

    records = []
    fetched_at = None
    cache_available = isinstance(cached, dict) and 'records' in cached
    if cache_available:
        records = cached.get('records') or []
        try:
            fetched_at = datetime.datetime.fromisoformat(
                str(cached.get('fetched_at') or '').replace('Z', '+00:00'))
            if fetched_at.tzinfo is None:
                fetched_at = fetched_at.replace(tzinfo=datetime.timezone.utc)
        except (TypeError, ValueError):
            fetched_at = None

    now = datetime.datetime.now(datetime.timezone.utc)
    fresh = (fetched_at is not None and
             (now - fetched_at).total_seconds() < DIVIDEND_CACHE_DAYS * 86400)
    if light_mode:
        if cache_available:
            print('LIGHT_MODE: using cached dividends for {} ({} records).\n'.format(
                stock_cn, len(records)))
        else:
            print('LIGHT_MODE: no dividend cache for {}; preserving prior output.\n'.format(
                stock_cn))
        return records, cache_available

    if cache_available and fresh and not force_refresh:
        age = (now - fetched_at).days
        print('Using dividend cache for {} ({} records, {} days old).\n'.format(
            stock_cn, len(records), age))
        return records, True

    try:
        fresh_records = fetcher() or []
        cache = {'fetched_at': now.isoformat(), 'records': fresh_records}
        od.put_pickle(cache_path, cache)
        print('Updated dividend cache for {} ({} records).\n'.format(
            stock_cn, len(fresh_records)))
        return fresh_records, True
    except Exception as e:  # noqa: BLE001
        if cache_available:
            print('Dividend refresh failed for {} ({}); using stale cache.\n'.format(
                stock_cn, e))
            return records, True
        print('Dividend refresh failed for {} ({}); no cache available.\n'.format(
            stock_cn, e))
        return [], False


def preserve_dividend_check(checks, old_output, cache_available):
    """Use the prior dividend check only when light mode has no cache yet."""
    if cache_available or not old_output:
        return checks
    old_check = (old_output.get('checks') or {}).get('dividends')
    if old_check:
        checks['dividends'] = (
            bool(old_check.get('pass')), str(old_check.get('text') or ''))
    return checks


def _parse_utc(value):
    try:
        dt = datetime.datetime.fromisoformat(str(value or '').replace('Z', '+00:00'))
        return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def _a_report_probe_key(rows):
    """Split latest A-share identities into annual and non-annual keys."""
    annual = None
    seasonal = None
    for row in (rows or []):
        report_type = str(row[1] if len(row) > 1 else '')
        if ('年报' in report_type or '年度' in report_type):
            if annual is None:
                annual = tuple(row)
        elif seasonal is None:
            seasonal = tuple(row)
    return {'yearly': annual, 'monthly': seasonal}


def report_refresh_decision(od, stock_cn, market, has_cache, proxies,
                            light_mode=False, force_refresh=False):
    """Return (needs_full_fetch, probe_key) using persistent report metadata.

    Full runs probe at most every 14 days. A changed probe key triggers a full
    report download; unchanged identities use the cached DataFrame. Every 28
    days a full validation is forced to catch same-period restatements. HK probe
    keys intentionally contain no Notice Date because that feed does not expose
    a reliable publication date.
    """
    if light_mode:
        return set(), None

    path = 'history/{}-F-Meta.pkl'.format(stock_cn)
    try:
        meta = od.get_pickle(path) or {}
    except Exception as e:  # noqa: BLE001
        print('WARN: report meta read failed for {} ({}).\n'.format(stock_cn, e))
        meta = {}
    now = datetime.datetime.now(datetime.timezone.utc)
    last_checked = _parse_utc(meta.get('last_checked'))
    last_full = _parse_utc(meta.get('last_full_check'))

    if has_cache and not force_refresh and last_checked is not None:
        if (now - last_checked).total_seconds() < REPORT_PROBE_DAYS * 86400:
            print('Report probe cache is fresh for {}; skipping probe.\n'.format(stock_cn))
            return set(), meta.get('probe_key')

    try:
        probe = (z_Func.probe_latest_reports_a(stock_cn, proxies)
                 if market == 'A' else
                 z_Func.probe_latest_report_hk(stock_cn, proxies))
        probe_key = _a_report_probe_key(probe) if market == 'A' else probe
    except Exception as e:  # noqa: BLE001
        print('Report probe failed for {} ({}); using cached reports.\n'.format(
            stock_cn, e))
        missing = ({'yearly', 'monthly'} if market == 'A' else {'hk'})
        return (missing if not has_cache else set()), meta.get('probe_key')

    # First deployment with an existing report cache: perform one full
    # validation so a newly published report cannot be mistaken for the baseline.
    if has_cache and not meta:
        print('No report metadata for {}; initial full validation required.\n'.format(
            stock_cn))
        return ({'yearly', 'monthly'} if market == 'A' else {'hk'}), probe_key

    old_key = meta.get('probe_key')
    if market == 'A':
        changed_kinds = {kind for kind in ('yearly', 'monthly')
                         if probe_key.get(kind) != (old_key or {}).get(kind)}
    else:
        changed_kinds = ({'hk'} if probe_key != old_key else set())
    changed = bool(changed_kinds)
    full_due = (not has_cache or force_refresh or last_full is None or
                (now - last_full).total_seconds() >= REPORT_FULL_CHECK_DAYS * 86400)
    if changed:
        print('New report identity detected for {}: {}.\n'.format(stock_cn, probe_key))
    elif full_due:
        print('Four-week full report validation due for {}.\n'.format(stock_cn))
    else:
        meta.update({'market': market, 'probe_key': probe_key,
                     'last_checked': now.isoformat()})
        od.put_pickle(path, meta)
        print('Report identity unchanged for {}; using cached reports.\n'.format(stock_cn))
        return set(), probe_key
    if full_due:
        return ({'yearly', 'monthly'} if market == 'A' else {'hk'}), probe_key
    return changed_kinds, probe_key


def mark_report_full_check(od, stock_cn, market, probe_key, full_validation=True):
    """Persist successful report-refresh metadata."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    path = 'history/{}-F-Meta.pkl'.format(stock_cn)
    try:
        meta = od.get_pickle(path) or {}
    except Exception:  # noqa: BLE001
        meta = {}
    meta.update({'market': market, 'probe_key': probe_key, 'last_checked': now})
    if full_validation:
        meta['last_full_check'] = now
    od.put_pickle(path, meta)


def merge_with_existing(od, stock_cn, payload, old=None):
    """Preserve prior good data when this run couldn't fetch part of it.

    The per-stock output/{code}.json is the source of truth, but a run may fail
    to produce some sections (e.g. a transient price/dividend-host failure).
    Rather
    than overwrite good data with nulls/empties, we merge the freshly built
    payload over whatever is already on OneDrive: any section missing in the new
    payload falls back to the stored one, flagged as carried-over.
    """
    if old is None:
        old = load_existing_output(od, stock_cn)
    if not old:
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
    if payload.get('chip_distribution') is None and old.get('chip_distribution') is not None:
        payload['chip_distribution'] = old['chip_distribution']
        stale.append('chip_distribution')
    if payload.get('valuation') is None and old.get('valuation') is not None:
        payload['valuation'] = old['valuation']
        stale.append('valuation')

    if stale:
        payload['carried_over'] = stale
        payload['carried_over_from'] = old.get('generated')
        print('   merged {} carried over from previous JSON for {}.\n'
              .format(', '.join(stale), stock_cn))
    return payload


PRICE_RANGE_ROW = '后一年股价范围'


def load_tencent_price_history(od, stock_cn, proxies):
    """Return (full_history_df, source_error) using an incremental OneDrive cache.

    The first run downloads unadjusted Tencent daily data from 2018 onward.
    Later runs fetch only the latest 300 trading days, merge by date (new wins),
    and retain every older cached row. The cache is written only when changed.
    """
    cache_path = 'history/{}-P-Tencent.pkl'.format(stock_cn)
    try:
        cached = od.get_pickle(cache_path)
    except Exception as e:  # noqa: BLE001
        print('WARN: Tencent price cache read failed for {} ({}).\n'.format(stock_cn, e))
        cached = None

    if cached is None or len(cached) == 0:
        full = z_Func.get_stock_price_from_tencent(stock_cn, proxies=proxies)
        if full is None or len(full) == 0:
            return full, True
        od.put_pickle(cache_path, full)
        print('Seeded Tencent price cache {} ({} rows).\n'.format(cache_path, len(full)))
        return full, False

    cached = cached.copy()
    cached['日期'] = pd.to_datetime(cached['日期'], errors='coerce')
    cached = cached.dropna(subset=['日期']).sort_values('日期').reset_index(drop=True)
    recent = z_Func.get_recent_stock_price_from_tencent(
        stock_cn, proxies=proxies, n=300)
    if recent is None or len(recent) == 0:
        print('Tencent recent-price fetch failed for {}; using cached history.\n'.format(stock_cn))
        return cached, True

    before = cached.to_json(orient='split', date_format='iso')
    merged = pd.concat([cached, recent], ignore_index=True)
    merged = (merged.drop_duplicates(subset=['日期'], keep='last')
              .sort_values('日期').reset_index(drop=True))
    after = merged.to_json(orient='split', date_format='iso')
    if after != before:
        od.put_pickle(cache_path, merged)
        print('Updated Tencent price cache {} ({} rows).\n'.format(cache_path, len(merged)))
    return merged, False


def _is_valid_range(v):
    """True if a stored price-range cell holds a real min-max (not nan/empty)."""
    if v is None:
        return False
    s = str(v).strip()
    if s == '' or s.lower() == 'nan-nan' or 'nan' in s.lower():
        return False
    return True


def load_old_price_ranges(od, stock_cn, old=None):
    """Return ({col_label: stored_range}, newest_col_label) from the prior
    output/{code}.json's combined table, restricted to the price-range row.

    newest_col_label is the last column of the stored combined (used to detect
    the 'just-closed' transition column). Returns ({}, None) on any failure.
    """
    try:
        if old is None:
            old = load_existing_output(od, stock_cn)
        if not old:
            return {}, None
        combined = old.get('combined')
        if not combined:
            return {}, None
        cols = combined.get('columns') or []
        index = combined.get('index') or []
        data = combined.get('data') or []
        if PRICE_RANGE_ROW not in index:
            return {}, (str(cols[-1]) if cols else None)
        row = data[index.index(PRICE_RANGE_ROW)]
        ranges = {str(cols[j]): row[j] for j in range(min(len(cols), len(row)))}
        newest = str(cols[-1]) if cols else None
        return ranges, newest
    except Exception:  # noqa: BLE001
        return {}, None


def apply_price_range_preservation(stock_price_yearly, stock_output_yearly,
                                   stock_price_df, old_ranges, old_newest):
    """Freeze closed-year price ranges, recompute the open (and just-closed
    transition) column, auto-fill missing closed years when kline covers the
    window, and record genuine gaps.

    Mutates/returns a copy of the yearly price-range row and a list of gap
    period labels. Columns follow Notice-Date order: i==0 is the open column.
    """
    row = stock_price_yearly.copy()
    gaps = []
    try:
        notice = list(stock_output_yearly.loc['Notice Date'])
    except Exception:  # noqa: BLE001
        return row, gaps
    cols = list(row.columns)
    try:
        kline_min = pd.to_datetime(stock_price_df['日期'].min())
    except Exception:  # noqa: BLE001
        kline_min = None

    for i, col in enumerate(cols):
        label = str(col)
        fresh = row.iloc[0, i]
        # window start for this column = its own Notice Date
        try:
            win_start = pd.to_datetime(notice[i])
        except Exception:  # noqa: BLE001
            win_start = None
        covered = (kline_min is not None and win_start is not None
                   and win_start >= kline_min and _is_valid_range(fresh))

        if i == 0:
            # open column: always take the fresh (still-changing) value
            continue
        if old_newest is not None and label == old_newest:
            # transition column: previously open, now just closed -> one final
            # full recompute, then it will be frozen on future runs
            continue

        old_val = old_ranges.get(label)
        if _is_valid_range(old_val):
            # closed year with good stored value -> freeze it
            row.iloc[0, i] = old_val
        elif covered:
            # missing/invalid old value but kline fully covers -> auto-fill
            pass  # keep fresh
        else:
            # genuine gap: keep whatever placeholder, flag for the user
            gaps.append(label)
    return row, gaps


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

    # LIGHT_MODE: daily price+chip refresh. It never hits financial/dividend hosts,
    # uses cached report/dividend data, and shortens the per-stock sleep.
    light_mode = os.environ.get('LIGHT_MODE', '').strip().lower() in ('1', 'true', 'yes')
    force_dividend_refresh = os.environ.get(
        'FORCE_DIVIDEND_REFRESH', '').strip().lower() in ('1', 'true', 'yes')
    force_report_refresh = os.environ.get(
        'FORCE_REPORT_REFRESH', '').strip().lower() in ('1', 'true', 'yes')
    if light_mode:
        print('LIGHT_MODE on: daily price+chip refresh (reports/dividends from '
              'cache, short sleeps).\n')

    history_names = [it['name'] for it in od.list_children('history') if 'file' in it]
    print('Found {} existing history files.\n'.format(len(history_names)))

    summary_rows = []
    chip_rows = []   # per-stock 获利比例 for output/_chip_ranking.json

    for iii, code in enumerate(stock_code):
        stock, stock_cn = normalize_stock(code)
        print('-----Stock No.{}--- {} ({}) begin ---\n'.format(iii, stock, stock_cn))

        if stock == 'F':
            print('Ford (F) is not handled in the personal-OneDrive batch yet; skipping.\n')
            continue

        # ---- Hong Kong branch (annual + interim/quarterly, live price, xlsx Notice Date) ----
        if str(stock).endswith('.HK'):
            old_output = load_existing_output(od, stock_cn)
            try:
                stock_output_yearly, stock_output_seasonly, stock_name, dps_map = \
                    process_reports_hk(
                        od, history_names, stock, proxies,
                        skip_fetch=light_mode,
                        force_refresh=force_report_refresh)
            except Exception as e:  # noqa: BLE001
                print('HK report processing failed for {} ({}: {}); skipping.\n'.format(
                    stock, type(e).__name__, e))
                continue
            if stock_output_yearly is None and stock_output_seasonly is None:
                print('No HK data for {}; skipping.\n'.format(stock))
                continue

            # Display-layer filter: keep only the single most recent 06-30 interim
            # (if it post-dates the latest annual); drop quarterlies + older
            # interims. pkl cache stays full.
            stock_output_seasonly = _hk_display_interim(
                stock_output_yearly, stock_output_seasonly)

            # HK dividends: cached for 21 days; light mode never hits EastMoney.
            plan_records, dividend_cache_available = load_dividend_records(
                od, stock_cn,
                lambda: z_Func.Dividend_Data_Yearly_from_Eas_Mon_HK(
                    stock, proxies, strict=True),
                light_mode=light_mode,
                force_refresh=force_dividend_refresh)
            if not dividend_cache_available and old_output:
                # First light run after deploying the cache: reconstruct enough
                # HK plan data from the prior JSON to keep its dividend rows.
                plan_records = [{
                    'year': str(r.get('REPORT_DATE') or '')[:4],
                    'notice_date': r.get('REPORT_DATE') or '',
                    'record_date': r.get('EQUITY_RECORD_DATE') or '',
                    'plan': r.get('IMPL_PLAN_PROFILE') or '',
                } for r in (old_output.get('dividends') or [])]
            print('HK dividend records for {}: {}.\n'.format(
                stock, len(plan_records or [])))

            dividends_df = None
            if plan_records:
                # Normalise to the same 3 columns A-shares use so the web/HTML
                # dividend table renders (公告日期/股权登记日/分红方案).
                dividends_df = pd.DataFrame([{
                    'REPORT_DATE': r.get('notice_date') or r.get('year') or '',
                    'EQUITY_RECORD_DATE': r.get('record_date') or '',
                    'IMPL_PLAN_PROFILE': r.get('plan') or '',
                } for r in plan_records])

            # HK price history: cached unadjusted daily from Tencent.
            last_7_days = None
            stock_price_df, price_source_error = load_tencent_price_history(
                od, stock_cn, proxies)
            if price_source_error:
                print('!! Tencent price fetch failed for {} — price-related '
                      'metrics not updated this run.\n'.format(stock))
            if len(stock_price_df) > 0:
                try:
                    last_7_days = z_Func.get_latest_7_days_stock_price_Based_on_EasMon(
                        stock_price_df=stock_price_df, proxy_add=proxy_add)
                except Exception:  # noqa: BLE001
                    last_7_days = None

            notice_fname = 'H{}_Notice_Date.xlsx'.format(stock.split('.')[0])
            notice_raw = od.get_bytes(notice_fname)

            def _build_hk_side(df, add_dividends, report_kind):
                """Prepend the Notice Date row, (optionally) append dividend rows,
                and append the price-range row — for one report-type frame."""
                if df is None:
                    return None
                notice_row = load_hk_notice_dates(
                    od, stock, list(df.columns), report_kind=report_kind,
                    raw=notice_raw, raw_preloaded=True)
                if 'Notice Date' in df.index:
                    df = df.drop(index='Notice Date')
                df = pd.concat([notice_row, df], axis=0)
                if add_dividends:
                    div_rows = build_dividend_rows_hk(df, dps_map, plan_records)
                    if div_rows is not None:
                        keep = df.drop(
                            index=[r for r in DIVIDEND_ROWS if r in df.index])
                        df = pd.concat([keep, div_rows], axis=0)
                if len(stock_price_df) > 0:
                    try:
                        pr = z_Func.get_stock_price_range_Based_on_EasMon(
                            stock_price_df=stock_price_df, stock_output=df,
                            day_one=day_one)
                        df = pd.concat([df, pr], axis=0)
                    except Exception as e:  # noqa: BLE001
                        print('HK price-range build failed for {} ({}).\n'.format(stock, e))
                return df

            # Dividend rows only on the annual side (mirrors A-shares, where the
            # seasonly frame carries no dividend rows).
            yearly_f = _build_hk_side(
                stock_output_yearly, add_dividends=True, report_kind='annual')
            seasonly_f = _build_hk_side(
                stock_output_seasonly, add_dividends=False, report_kind='interim')

            # Lay seasonly + yearly side by side (季度 + 年报), like A-shares.
            if seasonly_f is not None and yearly_f is not None:
                stock_output_combined = pd.concat([seasonly_f, yearly_f], axis=1)
            elif yearly_f is not None:
                stock_output_combined = yearly_f
            else:
                stock_output_combined = seasonly_f

            # Deterministic tail order: 后一年股价范围 before 分红行 (A-share layout).
            stock_output_combined = _reorder_hk_tail(stock_output_combined)

            # Checks run on the annual frame when present, else the seasonly one.
            checks_frame = stock_output_yearly if stock_output_yearly is not None \
                else stock_output_seasonly
            checks = evaluate_checks(checks_frame, plan_records or [])
            checks = preserve_dividend_check(
                checks, old_output, dividend_cache_available)
            summary_rows.append([
                '{}--{}-{}'.format(iii, stock, stock_name),
                str(checks['profit'][0]), str(checks['liabilities'][0]),
                str(checks['dividends'][0])])

            chip_hk = z_Func.get_chip_distribution_from_price_df(
                stock_cn, stock_price_df, proxies=proxies, is_hk=True)
            chip_rows.append({
                'stock_cn': stock_cn,
                'stock_name': stock_name,
                'profit_ratio': (chip_hk or {}).get('profit_ratio'),
                'latest_close': (chip_hk or {}).get('latest_close'),
                'avg_cost': (chip_hk or {}).get('avg_cost'),
                'cost_90_low': (chip_hk or {}).get('cost_90_low'),
                'cost_90_high': (chip_hk or {}).get('cost_90_high'),
                'cost_70_low': (chip_hk or {}).get('cost_70_low'),
                'cost_70_high': (chip_hk or {}).get('cost_70_high'),
                'as_of': (chip_hk or {}).get('as_of'),
            })
            quote = latest_price_quote(stock_price_df, 'HKD')
            valuation = (refresh_previous_valuation(old_output, quote) if light_mode else
                         build_valuation(stock_output_yearly, quote, stock_name=stock_name,
                                         stock_output_interim=stock_output_seasonly))
            payload = build_output(stock, stock_cn, stock_name, checks,
                                   stock_output_combined, last_7_days, dividends_df,
                                   chip_distribution=chip_hk,
                                   price_source_error=price_source_error,
                                   valuation=valuation)
            payload = merge_with_existing(od, stock_cn, payload, old=old_output)
            od.put_text('output/{}.json'.format(stock_cn),
                        json.dumps(payload, ensure_ascii=False, indent=2),
                        content_type='application/json; charset=utf-8')
            print('Wrote output/{}.json\n'.format(stock_cn))
            time.sleep(random.uniform(1, 3) if light_mode else random.uniform(7, 13))
            continue

        try:
            stock_output_yearly, stock_output_Seasonly, stock_name = process_reports(
                od, history_names, stock, stock_cn, proxies,
                skip_fetch=light_mode,
                force_refresh=force_report_refresh)
        except Exception as e:  # noqa: BLE001
            print('Report processing failed for {} ({}: {}); skipping.\n'.format(
                stock_cn, type(e).__name__, e))
            continue

        if stock_output_yearly is None:
            print('No yearly data for {}; skipping.\n'.format(stock_cn))
            continue

        old_output = load_existing_output(od, stock_cn)

        # A-share dividends: cached for 21 days; light mode never hits EastMoney.
        stock_0_dividends, dividend_cache_available = load_dividend_records(
            od, stock_cn,
            lambda: z_Func.Dividend_Data_Yearly_from_Eas_Mon(stock_cn, proxies),
            light_mode=light_mode,
            force_refresh=force_dividend_refresh)

        # Recompute the 3 dividend rows on full runs and persist them.
        # LIGHT_MODE skips this so the cached yearly pkl keeps its existing
        # dividend rows (no dividend fetch happened this run).
        if not light_mode:
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

        # --- price history: cached unadjusted daily from Tencent ---
        stock_price_df, price_source_error = load_tencent_price_history(
            od, stock_cn, proxies)
        if price_source_error:
            print('!! Tencent price fetch failed for {} — price-related '
                  'metrics not updated this run.\n'.format(stock_cn))

        stock_output_combined = None
        last_7_days = None
        price_range_gaps = []
        if len(stock_price_df) > 0:
            stock_price_yearly = z_Func.get_stock_price_range_Based_on_EasMon(
                stock_price_df=stock_price_df, stock_output=stock_output_yearly, day_one=day_one)
            old_ranges, old_newest = load_old_price_ranges(
                od, stock_cn, old=old_output)
            stock_price_yearly, price_range_gaps = apply_price_range_preservation(
                stock_price_yearly, stock_output_yearly, stock_price_df,
                old_ranges, old_newest)
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
        checks = preserve_dividend_check(
            checks, old_output, dividend_cache_available)
        summary_rows.append([
            '{}--{}-{}'.format(iii, stock, stock_name),
            str(checks['profit'][0]), str(checks['liabilities'][0]),
            str(checks['dividends'][0])])

        # --- chip distribution (筹码分布) via Tencent quotes (auto, non-EastMoney) ---
        chip = z_Func.get_chip_distribution_from_price_df(
            stock_cn, stock_price_df, proxies=proxies, is_hk=False)
        chip_rows.append({
            'stock_cn': stock_cn,
            'stock_name': stock_name,
            'profit_ratio': (chip or {}).get('profit_ratio'),
            'latest_close': (chip or {}).get('latest_close'),
            'avg_cost': (chip or {}).get('avg_cost'),
            'cost_90_low': (chip or {}).get('cost_90_low'),
            'cost_90_high': (chip or {}).get('cost_90_high'),
            'cost_70_low': (chip or {}).get('cost_70_low'),
            'cost_70_high': (chip or {}).get('cost_70_high'),
            'as_of': (chip or {}).get('as_of'),
        })
        quote = latest_price_quote(stock_price_df, 'CNY')
        valuation = (refresh_previous_valuation(old_output, quote) if light_mode else
                     build_valuation(stock_output_yearly, quote, stock_name=stock_name,
                                     stock_output_interim=stock_output_Seasonly))

        payload = build_output(stock, stock_cn, stock_name, checks,
                               stock_output_combined, last_7_days, dividends_df,
                               chip_distribution=chip,
                               price_source_error=price_source_error,
                               valuation=valuation)
        payload['price_range_gaps'] = price_range_gaps
        payload = merge_with_existing(od, stock_cn, payload, old=old_output)
        od.put_text('output/{}.json'.format(stock_cn),
                    json.dumps(payload, ensure_ascii=False, indent=2),
                    content_type='application/json; charset=utf-8')
        print('Wrote output/{}.json\n'.format(stock_cn))

        time.sleep(random.uniform(1, 3) if light_mode else random.uniform(7, 13))

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
    print('Task Completed Successfully! Wrote output/_summary.json\n')

    # --- chip ranking (获利比例排行) — pre-aggregated for the web ranking tab ---
    # Same partial-run merge as _summary.json: keep untouched stocks' rows and
    # replace only the ones this run computed (keyed by stock_cn).
    if partial_run:
        touched = {r['stock_cn'] for r in chip_rows}
        existing_cr = od.get_bytes('output/_chip_ranking.json')
        kept_cr = []
        if existing_cr:
            try:
                for r in json.loads(existing_cr.decode('utf-8')):
                    if r.get('stock_cn') not in touched:
                        kept_cr.append(r)
            except Exception as e:  # noqa: BLE001
                print('WARN: could not merge existing _chip_ranking.json ({}); '
                      'writing only this run\'s rows.\n'.format(e))
        chip_ranking = kept_cr + chip_rows
    else:
        chip_ranking = chip_rows
    od.put_text('output/_chip_ranking.json',
                json.dumps(chip_ranking, ensure_ascii=False),
                content_type='application/json; charset=utf-8')
    print('Wrote output/_chip_ranking.json ({} stocks).\n'.format(len(chip_ranking)))


if __name__ == '__main__':
    main()
