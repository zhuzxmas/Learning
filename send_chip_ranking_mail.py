#!/usr/bin/env python3
"""Email the 筹码排行 (chip-distribution ranking) table after the finance batch.

Reads the ranking, valuation settings, configured output files and family stock
ledger, then renders the web table's first eight columns using its default order and
emails it via Microsoft Graph ``/users/{from}/sendMail`` (app-only token from
funcLG.func_login_secret, i.e. CLIENT_ID/CLIENT_SECRET/TENANT_ID).

Env / secrets:
  STOCK_MAIL_FROM   sender mailbox / UPN (must be a real Exchange mailbox in the
                    same tenant as CLIENT_ID; app needs Application Mail.Send)
  STOCK_MAIL_TO     recipient address
  CLIENT_ID / CLIENT_SECRET / TENANT_ID   (used by funcLG for the Graph token)
  ONEDRIVE_CLIENT_ID / TOKEN_ENC_KEY / ONEDRIVE_REFRESH_TOKEN  (OneDrive read)

Failure is non-fatal to the batch: this runs as its own workflow step and only
warns on error (the workflow uses continue-on-error).
"""

import datetime
import csv
import html as html_lib
import io
import json
import math
import os
import sys

import requests

import funcLG
import onedrive_personal as op


DEFAULT_STOCK_FOLDER_SHARE_URL = (
    "https://1drv.ms/f/c/7f804b34b24d36bb/"
    "IgDkv42DfbuDTJfM1C3hWX1FAXlv1jCiXLSpnrL-BqpZhQU?email=celine_mas%40outlook.com&e=F7TDX1")


def _fmt_pct(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "—"
    return "—" if not math.isfinite(n) else "{:.1f}%".format(n * 100)


def _fmt_num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "—"
    return "—" if not math.isfinite(n) else "{:.2f}".format(n)


def _fmt_rng(lo, hi):
    return "—" if (lo is None or hi is None) else "{} ~ {}".format(lo, hi)


def _yn(v):
    return "✔" if v else "✘"


def _opportunity(v):
    return "是" if v is True else "否" if v is False else "—"


def _canonical_code(value):
    import re
    text = str(value or "").strip().upper()
    match = re.search(r"(?:^|[^0-9])(\d{5})\.HK(?:$|[^A-Z0-9])", text)
    if match:
        return match.group(1) + ".HK"
    match = re.search(r"H\s*0*(\d{1,5})", text)
    if match:
        return match.group(1).zfill(5) + ".HK"
    match = re.search(r"(?:^|\D)(\d{6})(?:\D|$)", text)
    if not match:
        return None
    code = match.group(1)
    return code + (".SH" if code.startswith("6") else ".SZ")


def _configured_code(value):
    text = str(value or "").replace(" ", "").strip()
    if text[:1].upper() == "H" and text[1:].isdigit():
        return text[1:].zfill(5) + ".HK"
    digits = "".join(character for character in text if character.isdigit()).zfill(6)
    if len(digits) != 6:
        return None
    return digits + (".SH" if digits.startswith("6") else ".SZ")


def _held_codes(records):
    totals = {}
    for record in records or []:
        code = _canonical_code((record or {}).get("code"))
        try:
            shares = float((record or {}).get("shares"))
        except (TypeError, ValueError):
            continue
        if code and math.isfinite(shares):
            totals[code] = totals.get(code, 0.0) + shares
    return {code for code, shares in totals.items() if shares < -0.5}


def _configured_codes(raw_csv):
    rows = [row for row in csv.reader(io.StringIO((raw_csv or "").lstrip("\ufeff")))
            if any(cell.strip() for cell in row)]
    if not rows:
        return set()
    header = [cell.strip().lower() for cell in rows[0]]
    index, data = 0, rows
    for candidate in ("title", "code", "stock", "stock_code", "stock number", "stock_number"):
        if candidate in header:
            index, data = header.index(candidate), rows[1:]
            break
    return {_configured_code(row[index]) for row in data
            if index < len(row) and _configured_code(row[index])}


def _profit_sort_value(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return (1, 0.0)
    return (0, number) if math.isfinite(number) else (1, 0.0)


def _summary_flags(summary):
    """numeric-code -> {b_profit,b_liab,b_div} from _summary.json."""
    out = {}
    for r in (summary or []):
        if not isinstance(r, dict):
            continue
        sn = str((r or {}).get("Stock Number", ""))
        rest = "--".join(sn.split("--")[1:])          # drop "{seq}--"
        stock = rest.split("-")[0] if rest else ""     # 600519.ss / 01548.HK
        numeric = stock.split(".")[0].strip()
        if not numeric:
            continue
        truthy = lambda x: str(x) == "True" or x is True  # noqa: E731
        out[numeric] = {
            "b_profit": truthy(r.get("利润表现好")),
            "b_liab": truthy(r.get("流动负债不高")),
            "b_div": truthy(r.get("分红多")),
        }
    return out


def _normalize_settings(value):
    if (not isinstance(value, dict) or
            not isinstance(value.get("defaults"), dict) or
            not isinstance(value.get("stocks"), dict)):
        return {"version": 2, "defaults": {}, "stocks": {}}
    return value


def build_rows(ranking, summary, settings, configured, output_codes, holdings):
    flags = _summary_flags(summary)
    stock_settings = _normalize_settings(settings)["stocks"]
    rows = []
    for r in (ranking or []):
        if not isinstance(r, dict):
            continue
        code = str(r.get("stock_cn") or "")
        if not code or code not in configured or code not in output_codes:
            continue
        numeric = code.split(".")[0].strip()
        f = flags.get(numeric, {})
        manual = stock_settings.get(code) or {}
        if not isinstance(manual, dict):
            manual = {}
        row = dict(r)
        row.update({
            "stock_cn": code,
            "is_held": code in holdings,
            "b_profit": bool(f.get("b_profit")), "b_liab": bool(f.get("b_liab")),
            "b_div": bool(f.get("b_div")),
            "potential_opportunity": (None if manual.get("potential_opportunity") is None
                                      else bool(manual.get("potential_opportunity"))),
            "target_price": manual.get("target_price"),
            "opportunity_reason": manual.get("opportunity_reason") or "",
        })
        rows.append(row)
    opportunity_rank = lambda value: 0 if value is True else 1 if value is False else 2  # noqa: E731
    rows.sort(key=lambda row: (
        0 if row["is_held"] else 1,
        opportunity_rank(row["potential_opportunity"]),
        _profit_sort_value(row.get("profit_ratio")),
        row["stock_cn"],
    ))
    return rows


def build_html(ranking, summary, settings, configured, output_codes, holdings,
               holdings_available=True):
    rows = build_rows(ranking, summary, settings, configured, output_codes, holdings)
    rep_date = max((str(row.get("as_of")) for row in rows if row.get("as_of")), default="")

    price_hdr = ("{}当前股价".format(rep_date) if rep_date else "当前股价")
    th = ("<th>股票</th><th>潜在机会</th><th>目标价格</th><th>{}</th><th>原因</th>"
          "<th>获利比例</th><th>平均成本</th>"
          "<th>90%成本区间</th>").format(html_lib.escape(price_hdr))
    body_rows = []
    for x in rows:
        code = x["stock_cn"]
        name = x.get("stock_name") or ""
        label = ("{}{} {}".format("*" if x["is_held"] else "", code, name)
                 if name else ("*" if x["is_held"] else "") + code)
        body_rows.append(
            "<tr>"
            "<td>{}</td>".format(html_lib.escape(label))
            + "<td style='text-align:center'>{}</td>".format(_opportunity(x["potential_opportunity"]))
            + "<td style='text-align:right'>{}</td>".format(_fmt_num(x.get("target_price")))
            + "<td style='text-align:right'>{}</td>".format(_fmt_num(x.get("latest_close")))
            + "<td class='reason' title='{}'>{}</td>".format(
                html_lib.escape(str(x["opportunity_reason"]), quote=True),
                html_lib.escape(str(x["opportunity_reason"] or "—")))
            + "<td style='text-align:right'>{}</td>".format(_fmt_pct(x.get("profit_ratio")))
            + "<td style='text-align:right'>{}</td>".format(_fmt_num(x.get("avg_cost")))
            + "<td style='text-align:right'>{}</td>".format(html_lib.escape(_fmt_rng(x.get("cost_90_low"), x.get("cost_90_high"))))
            + "</tr>")
    style = ("table{border-collapse:collapse;font-family:sans-serif;font-size:13px}"
              "th,td{border:1px solid #ddd;padding:6px 10px;white-space:nowrap}"
              "th{background:#f2f4f7;text-align:left}"
              ".reason{max-width:220px;overflow:hidden;text-overflow:ellipsis}")
    warning = ("<p style='color:#9a5b00'>持仓状态读取失败，本次未应用持仓优先排序和 * 标记。</p>"
               if not holdings_available else "")
    html = ("<html><head><meta charset='utf-8'><style>{}</style></head><body>"
             "<h3>选股 · 筹码排行（网页默认排序）</h3>{}"
             "<p style='color:#666'>数据日期：{}　共 {} 只</p>"
             "<table><thead><tr>{}</tr></thead><tbody>{}</tbody></table>"
             "</body></html>").format(
        style, warning, html_lib.escape(rep_date or "—"), len(rows), th, "".join(body_rows))
    return html, rep_date, len(rows)


def send_mail(html, subject, sender, recipient, proxies):
    login = funcLG.func_login_secret()
    result = login["result"]
    if "access_token" not in result:
        raise RuntimeError("Graph app token failed: {} {}".format(
            result.get("error"), result.get("error_description")))
    headers = {
        "Authorization": "Bearer " + result["access_token"],
        "Content-Type": "application/json",
    }
    payload = json.dumps({
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html},
            "toRecipients": [{"emailAddress": {"address": recipient}}],
        },
        "saveToSentItems": True,
    })
    url = "https://graph.microsoft.com/v1.0/users/{}/sendMail".format(sender)
    try:
        r = requests.post(url, headers=headers, data=payload)
    except requests.exceptions.RequestException:
        r = requests.post(url, headers=headers, data=payload, proxies=proxies)
    if r.status_code == 202:
        print("Mail sent (202) to {} from {}.".format(recipient, sender))
        return True
    print("Mail send FAILED: {} {}".format(r.status_code, r.text[:500]))
    return False


def main():
    sender = os.environ.get("STOCK_MAIL_FROM", "").strip()
    recipient = os.environ.get("STOCK_MAIL_TO", "").strip()
    if not sender or not recipient:
        print("STOCK_MAIL_FROM / STOCK_MAIL_TO not set; skipping mail.")
        return 0

    proxy = op.load_config_cfg_env() if hasattr(op, "load_config_cfg_env") else None
    proxies = {"http": proxy, "https": proxy} if proxy else None

    # Read-only OneDrive access — never rewrite the shared rt.enc.
    os.environ.setdefault("ONEDRIVE_RT_READONLY", "1")
    od = op.OneDrivePersonal(proxies=proxies, rt_readonly=True)

    ranking = json.loads(od.get_text("output/_chip_ranking.json") or "[]")
    try:
        summary = json.loads(od.get_text("output/_summary.json") or "[]")
        if not isinstance(summary, list):
            summary = []
    except Exception as exc:  # noqa: BLE001
        print("WARN: summary unavailable; using empty flags: {}".format(exc))
        summary = []
    try:
        settings = _normalize_settings(json.loads(
            od.get_text("valuation-settings.json") or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        print("WARN: valuation settings invalid; using empty settings: {}".format(exc))
        settings = _normalize_settings(None)
    configured = _configured_codes(od.get_text("stock_list.csv") or "")
    output_codes = {
        str(item.get("name", ""))[:-5]
        for item in od.list_children("output")
        if str(item.get("name", "")).lower().endswith(".json")
        and not str(item.get("name", "")).startswith("_")
    }
    output_codes.discard("")
    if not ranking:
        print("No _chip_ranking.json data; skipping mail.")
        return 0

    holdings_available = True
    holdings = set()
    try:
        share_url = os.environ.get(
            "STOCK_FOLDER_SHARE_URL", DEFAULT_STOCK_FOLDER_SHARE_URL).strip()
        ledger = json.loads(od.get_shared_text(share_url, "stock-records.json") or "{}")
        holdings = _held_codes((ledger or {}).get("records") or [])
    except Exception as exc:  # noqa: BLE001
        holdings_available = False
        print("WARN: holdings unavailable; sending degraded ranking: {}: {}".format(
            type(exc).__name__, exc))

    html, rep_date, n = build_html(
        ranking, summary, settings, configured, output_codes, holdings,
        holdings_available=holdings_available)
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    subject = "选股 · 筹码排行 {}（{} 只）".format(rep_date or today, n)
    ok = send_mail(html, subject, sender, recipient, proxies)
    return 0 if ok else 0   # non-fatal either way


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print("Mail step error (non-fatal): {}: {}".format(type(e).__name__, e))
        sys.exit(0)
