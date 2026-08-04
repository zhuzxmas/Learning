#!/usr/bin/env python3
"""Phase 2 — kline download manifest generator.

The EastMoney historical kline host (push2his) is not reliably reachable from
cloud / datacenter IPs, so ``finance_batch_personal.py`` reads price history from
pre-downloaded ``kline/{code}.txt`` files instead of calling the API. This
script builds the list of URLs you need to open in a browser (where EastMoney
works) and save as those files.

For each stock in ``stock_list.csv`` it computes the kline API URL and writes a
manifest to OneDrive:

  * ``kline/_manifest.html`` — clickable links, each labelled with the exact
    filename to save the page as ({code}.txt). Open this in a browser, click a
    link, then Save Page As ``kline/{code}.txt``.
  * ``kline/_manifest.csv``  — code,filename,url (for scripting/reference).

By default only stocks **missing** a ``kline/{code}.txt`` file are included; pass
``--all`` to (re)generate every stock. The manifest is also printed to stdout.

Usage:
    python kline_manifest.py            # only stocks missing a kline file
    python kline_manifest.py --all      # every stock in the list
    LMT=1800 python kline_manifest.py   # override the number of days (default 1800)
"""

import datetime
import os
import sys

# UTF-8 stdout for Windows consoles (Chinese-safe, harmless elsewhere).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

import onedrive_personal as op
from finance_batch_personal import load_stock_list, normalize_stock

LMT = os.environ.get("LMT", "1800").strip() or "1800"


def build_kline_url(stock_cn, lmt=LMT, end=None):
    """Reconstruct the EastMoney kline API URL for an A-share code.

    Mirrors z_Func.get_stock_price_Raw_Data_EasMon: SH -> market 1, SZ -> 0,
    HK -> market 116 (mirrors get_stock_price_Raw_Data_EasMon_HK), daily candles
    (klt=101), forward-adjusted (fqt=1), JSONP callback quote_jp4
    (finance_batch_personal strips the callback wrapper when parsing).
    """
    if end is None:
        end = datetime.datetime.now().strftime("%Y%m%d")
    if stock_cn.endswith(".SH"):
        code, mkt = stock_cn[:6], 1
    elif stock_cn.endswith(".SZ"):
        code, mkt = stock_cn[:6], 0
    elif stock_cn.endswith(".HK"):
        code, mkt = stock_cn.split(".")[0], 116
    else:
        return None
    return (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get"
        "?secid={mkt}.{code}"
        "&fields1=f1,f2,f3,f4,f5,f6"
        "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        "&klt=101&fqt=1&end={end}&lmt={lmt}&cb=quote_jp4"
    ).format(mkt=mkt, code=code, end=end, lmt=lmt)


def main():
    include_all = "--all" in sys.argv[1:]

    proxy = op.load_config_cfg_env()
    proxies = {"http": proxy, "https": proxy} if proxy else None
    od = op.OneDrivePersonal(proxies=proxies)

    codes = load_stock_list(od)
    print("Loaded {} stock codes from stock_list.csv.".format(len(codes)))

    existing = {it["name"] for it in od.list_children("kline") if "file" in it}
    print("Found {} existing kline files.".format(len(existing)))

    entries = []  # (stock_cn, filename, url)
    for code in codes:
        stock, stock_cn = normalize_stock(code)
        if stock == "F":
            continue
        filename = "{}.txt".format(stock_cn)
        if not include_all and filename in existing:
            continue
        url = build_kline_url(stock_cn)
        if url:
            entries.append((stock_cn, filename, url))

    if not entries:
        print("\nNothing to do — every stock already has a kline file. "
              "Use --all to regenerate.")
        return

    # --- console output ---
    print("\n{} kline file(s) to download (end={}, lmt={}):\n".format(
        len(entries), datetime.datetime.now().strftime("%Y%m%d"), LMT))
    for stock_cn, filename, url in entries:
        print("  {}\n    {}\n".format(filename, url))

    # --- CSV manifest ---
    csv_lines = ["code,filename,url"]
    for stock_cn, filename, url in entries:
        csv_lines.append('{},{},"{}"'.format(stock_cn, filename, url))
    od.put_text("kline/_manifest.csv", "\n".join(csv_lines),
                content_type="text/csv; charset=utf-8")

    # --- HTML manifest (clickable, labelled with target filename) ---
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    rows = ["<!DOCTYPE html><html><head><meta charset='utf-8'>",
            "<title>Kline download manifest {}</title>".format(today),
            "<style>body{font-family:sans-serif;line-height:1.6}"
            "li{margin-bottom:.6em}code{background:#eee;padding:1px 4px}</style>",
            "</head><body>",
            "<h2>Kline download manifest — {}</h2>".format(today),
            "<p>For each link: open it, then <b>Save Page As</b> the filename "
            "shown, into <code>Apps/StockBatchTracker/kline/</code>.</p>",
            "<p>end={}, lmt={}. {} file(s) needed.</p><ol>".format(
                datetime.datetime.now().strftime("%Y%m%d"), LMT, len(entries))]
    for stock_cn, filename, url in entries:
        rows.append(
            "<li><b>{fn}</b> &nbsp; "
            "<a href='{url}' target='_blank' rel='noopener'>open kline</a></li>"
            .format(fn=filename, url=url))
    rows.append("</ol></body></html>")
    od.put_text("kline/_manifest.html", "".join(rows),
                content_type="text/html; charset=utf-8")

    print("Wrote kline/_manifest.html and kline/_manifest.csv to OneDrive.")
    print("Open kline/_manifest.html in a browser to download the files.")


if __name__ == "__main__":
    main()
