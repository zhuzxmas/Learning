#!/usr/bin/env python3
"""Email the 筹码排行 (chip-distribution ranking) table after the finance batch.

Reads the pre-aggregated ``output/_chip_ranking.json`` and ``output/_summary.json``
from the stock batch's personal OneDrive, joins the three 汇总 flags, sorts by
获利比例 ascending (nulls last), renders the same table the web page shows, and
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
import json
import os
import sys

import requests

import funcLG
import onedrive_personal as op


def _fmt_pct(v):
    return "—" if v is None else "{:.1f}%".format(v * 100)


def _fmt_num(v):
    return "—" if v is None else str(v)


def _fmt_rng(lo, hi):
    return "—" if (lo is None or hi is None) else "{} ~ {}".format(lo, hi)


def _yn(v):
    return "✔" if v else "✘"


def _summary_flags(summary):
    """numeric-code -> {b_profit,b_liab,b_div} from _summary.json."""
    out = {}
    for r in (summary or []):
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


def build_html(ranking, summary):
    flags = _summary_flags(summary)
    rows = []
    rep_date = ""
    for r in (ranking or []):
        code = str(r.get("stock_cn") or "")
        if not code:
            continue
        numeric = code.split(".")[0].strip()
        f = flags.get(numeric, {})
        if r.get("as_of") and str(r["as_of"]) > rep_date:
            rep_date = str(r["as_of"])
        rows.append({
            "code": code,
            "name": r.get("stock_name") or "",
            "profit_ratio": r.get("profit_ratio"),
            "latest_close": r.get("latest_close"),
            "avg_cost": r.get("avg_cost"),
            "cost_90_low": r.get("cost_90_low"), "cost_90_high": r.get("cost_90_high"),
            "cost_70_low": r.get("cost_70_low"), "cost_70_high": r.get("cost_70_high"),
            "b_profit": bool(f.get("b_profit")), "b_liab": bool(f.get("b_liab")),
            "b_div": bool(f.get("b_div")),
        })

    # 获利比例 ascending, nulls last.
    rows.sort(key=lambda x: (x["profit_ratio"] is None,
                             x["profit_ratio"] if x["profit_ratio"] is not None else 0.0))

    price_hdr = ("{}收盘价".format(rep_date) if rep_date else "收盘价")
    th = ("<th>股票</th><th>获利比例</th><th>{}</th><th>平均成本</th>"
          "<th>90%成本区间</th><th>70%成本区间</th>"
          "<th>利润好</th><th>负债低</th><th>分红多</th>").format(price_hdr)
    body_rows = []
    for x in rows:
        label = ("{} {}".format(x["code"], x["name"]) if x["name"] else x["code"])
        body_rows.append(
            "<tr>"
            "<td>{}</td>".format(label)
            + "<td style='text-align:right'>{}</td>".format(_fmt_pct(x["profit_ratio"]))
            + "<td style='text-align:right'>{}</td>".format(_fmt_num(x["latest_close"]))
            + "<td style='text-align:right'>{}</td>".format(_fmt_num(x["avg_cost"]))
            + "<td style='text-align:right'>{}</td>".format(_fmt_rng(x["cost_90_low"], x["cost_90_high"]))
            + "<td style='text-align:right'>{}</td>".format(_fmt_rng(x["cost_70_low"], x["cost_70_high"]))
            + "<td style='text-align:center'>{}</td>".format(_yn(x["b_profit"]))
            + "<td style='text-align:center'>{}</td>".format(_yn(x["b_liab"]))
            + "<td style='text-align:center'>{}</td>".format(_yn(x["b_div"]))
            + "</tr>")
    style = ("table{border-collapse:collapse;font-family:sans-serif;font-size:13px}"
             "th,td{border:1px solid #ddd;padding:6px 10px;white-space:nowrap}"
             "th{background:#f2f4f7;text-align:left}")
    html = ("<html><head><meta charset='utf-8'><style>{}</style></head><body>"
            "<h3>选股 · 筹码排行（获利比例升序）</h3>"
            "<p style='color:#666'>数据日期：{}　共 {} 只</p>"
            "<table><thead><tr>{}</tr></thead><tbody>{}</tbody></table>"
            "</body></html>").format(
        style, rep_date or "—", len(rows), th, "".join(body_rows))
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
    except Exception:  # noqa: BLE001
        summary = []
    if not ranking:
        print("No _chip_ranking.json data; skipping mail.")
        return 0

    html, rep_date, n = build_html(ranking, summary)
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
