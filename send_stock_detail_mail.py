#!/usr/bin/env python3
"""Send one saved StockBatchTracker detail page to the fixed mail recipient."""

import datetime
import html
import json
import math
import os
import re
import sys

import onedrive_personal as op
import valuation_engine
from send_chip_ranking_mail import send_mail


def canonical_stock(value):
    text = str(value or "").strip().upper()
    if re.fullmatch(r"[0-9]{5}\.HK", text):
        return text
    if re.fullmatch(r"[0-9]{6}\.(SH|SZ)", text):
        return text
    raise ValueError("invalid stock code")


def esc(value):
    return html.escape(str(value if value not in (None, "") else "—"))


def number(value, digits=2):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return "—"
    return "—" if not math.isfinite(result) else ("{:.%df}" % digits).format(result)


def percent(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return "—"
    return "—" if not math.isfinite(result) else "{:.1f}%".format(result * 100)


def table(headers, rows, css_class=""):
    head = "".join("<th>{}</th>".format(esc(item)) for item in headers)
    body = "".join("<tr>{}</tr>".format("".join(
        "<td>{}</td>".format(esc(cell)) for cell in row)) for row in rows)
    return "<table class='{}'><thead><tr>{}</tr></thead><tbody>{}</tbody></table>".format(
        css_class, head, body)


def build_detail_html(stock_data, settings):
    data = stock_data if isinstance(stock_data, dict) else {}
    code = canonical_stock(data.get("stock_cn") or data.get("stock"))
    name = data.get("stock_name") or ""
    valuation = data.get("valuation") if isinstance(data.get("valuation"), dict) else {}
    quote = valuation.get("quote") if isinstance(valuation.get("quote"), dict) else {}
    comparison = valuation.get("comparison") if isinstance(valuation.get("comparison"), dict) else {}
    asset = valuation.get("asset_value") if isinstance(valuation.get("asset_value"), dict) else {}
    epv = valuation.get("epv") if isinstance(valuation.get("epv"), dict) else {}
    currency = valuation.get("currency") or quote.get("currency") or ("HKD" if code.endswith(".HK") else "CNY")
    stock_settings = ((settings or {}).get("stocks") or {}).get(code) or {}
    assumptions = dict(valuation_engine.DEFAULT_ASSUMPTIONS)
    assumptions.update((settings or {}).get("defaults") or {})
    valuation_keys = set(valuation_engine.DEFAULT_ASSUMPTIONS)
    assumptions.update({key: value for key, value in stock_settings.items() if key in valuation_keys})
    if valuation.get("applicable") is not False and isinstance(valuation.get("raw_periods"), list):
        recalculated = valuation_engine.calculate(
            valuation.get("raw_periods"), assumptions=assumptions,
            industry=valuation.get("industry"), org_type=valuation.get("org_type"),
            current_price=quote.get("current_price"), currency=currency,
            snapshot=valuation.get("snapshot"))
        valuation = dict(valuation, **recalculated)
        comparison = valuation.get("comparison") if isinstance(valuation.get("comparison"), dict) else {}
        asset = valuation.get("asset_value") if isinstance(valuation.get("asset_value"), dict) else {}
        epv = valuation.get("epv") if isinstance(valuation.get("epv"), dict) else {}
    opportunity = stock_settings.get("potential_opportunity")
    opportunity_text = "是" if opportunity is True else "否" if opportunity is False else "未评估"

    checks = data.get("checks") if isinstance(data.get("checks"), dict) else {}
    check_rows = []
    for value in checks.values():
        if isinstance(value, dict):
            check_rows.append(["通过" if value.get("pass") else "未通过", value.get("text") or ""])

    summary_rows = [
        ["数据生成时间", data.get("generated")],
        ["股价日期", quote.get("as_of")],
        ["估值报告期", valuation.get("as_of")],
        ["资产快照日期", valuation.get("snapshot_as_of")],
        ["资产快照类型", "半年报" if valuation.get("snapshot_type") == "interim" else "年报"],
        ["盈利年报数量", valuation.get("periods_used") or len(valuation.get("raw_periods") or [])],
        ["当前股价", "{} {}".format(currency, number(quote.get("current_price")))],
        ["每股 AV", "{} {}".format(currency, number(asset.get("per_share")))],
        ["每股 EPV", "{} {}".format(currency, number(epv.get("per_share")))],
        ["EPV−AV", number(comparison.get("epv_minus_asset_value"))],
        ["AV 安全边际", percent(comparison.get("asset_margin_of_safety"))],
        ["EPV 安全边际", percent(comparison.get("epv_margin_of_safety"))],
        ["估值完整", "是" if valuation.get("complete") else "否"],
        ["缺失字段", "、".join(valuation.get("missing") or [])],
        ["资本成本", percent(assumptions.get("capitalization_rate"))],
    ]
    valuation_detail_rows = [
        ["应收系数", percent(assumptions.get("receivables"))],
        ["存货系数", percent(assumptions.get("inventory"))],
        ["固定资产系数", percent(assumptions.get("fixed_assets"))],
        ["其他资产系数", percent(assumptions.get("other_assets"))],
        ["资本成本", percent(assumptions.get("capitalization_rate"))],
        ["缺省税率", percent(assumptions.get("fallback_tax_rate"))],
        ["正常化 EBIT 率", percent(epv.get("normalized_ebit_margin"))],
        ["有效税率", percent(epv.get("effective_tax_rate"))],
        ["正常化经营收益", "{} {}".format(currency, number(epv.get("normalized_operating_earnings")))],
        ["维持性资本开支", "{} {}".format(currency, number(epv.get("maintenance_capex")))],
        ["账面总资产", "{} {}".format(currency, number((valuation.get("snapshot") or {}).get("total_assets")))],
        ["调整后资产", "{} {}".format(currency, number(asset.get("adjusted_assets")))],
        ["总负债", "{} {}".format(currency, number((valuation.get("snapshot") or {}).get("total_liabilities")))],
        ["少数股东权益", "{} {}".format(currency, number((valuation.get("snapshot") or {}).get("minority_interest")))],
        ["股东资产价值", "{} {}".format(currency, number(asset.get("equity_value")))],
    ]
    sensitivity_rows = []
    raw_periods = valuation.get("raw_periods") if isinstance(valuation.get("raw_periods"), list) else []
    snapshot = valuation.get("snapshot") if isinstance(valuation.get("snapshot"), dict) else None
    if raw_periods and valuation.get("applicable") is not False:
        scenarios = [
            ("清算情景", {'receivables': .75, 'inventory': .50,
                        'fixed_assets': .35, 'other_assets': .25}),
            ("当前 AV 参数", {}),
            ("调整净资产情景", {'receivables': 1, 'inventory': 1,
                              'fixed_assets': 1, 'other_assets': 1}),
        ]
        price = quote.get("current_price")
        for label, overrides in scenarios:
            result = valuation_engine.calculate(
                raw_periods, assumptions=dict(assumptions, **overrides), snapshot=snapshot)
            value = (result.get('asset_value') or {}).get('per_share')
            margin = (1 - float(price) / value) if price not in (None, '') and value and value > 0 else None
            sensitivity_rows.append([label, "{} {}".format(currency, number(value)), percent(margin)])
        rates = sorted(set([.08, assumptions.get('capitalization_rate'), .10, .12]))
        for rate in rates:
            result = valuation_engine.calculate(
                raw_periods, assumptions=dict(assumptions, capitalization_rate=rate), snapshot=snapshot)
            value = (result.get('epv') or {}).get('per_share')
            margin = (1 - float(price) / value) if price not in (None, '') and value and value > 0 else None
            sensitivity_rows.append([
                "EPV {:.1f}%".format(rate * 100),
                "{} {}".format(currency, number(value)), percent(margin)])
    opportunity_rows = [
        ["潜在机会", opportunity_text],
        ["目标价格", "{} {}".format(currency, number(stock_settings.get("target_price")))],
        ["原因", stock_settings.get("opportunity_reason")],
        ["更新时间", stock_settings.get("opportunity_updated_at")],
        ["更新人", stock_settings.get("opportunity_updated_by")],
    ]

    chip = data.get("chip_distribution") if isinstance(data.get("chip_distribution"), dict) else {}
    chip_rows = [["获利比例", percent(chip.get("profit_ratio"))],
                 ["当前股价", number(chip.get("latest_close"))],
                 ["平均成本", number(chip.get("avg_cost"))],
                 ["90%成本区间", "{} ~ {}".format(number(chip.get("cost_90_low")), number(chip.get("cost_90_high")))],
                 ["70%成本区间", "{} ~ {}".format(number(chip.get("cost_70_low")), number(chip.get("cost_70_high")))]]

    combined = data.get("combined") if isinstance(data.get("combined"), dict) else {}
    columns = combined.get("columns") if isinstance(combined.get("columns"), list) else []
    indexes = combined.get("index") if isinstance(combined.get("index"), list) else []
    values = combined.get("data") if isinstance(combined.get("data"), list) else []
    financial_rows = [[label] + (values[index] if index < len(values) and isinstance(values[index], list) else [])
                      for index, label in enumerate(indexes)]

    dividends = data.get("dividends") if isinstance(data.get("dividends"), list) else []
    dividend_headers = list(dict.fromkeys(
        key for record in dividends if isinstance(record, dict) for key in record.keys()))
    dividend_rows = [[record.get(key) for key in dividend_headers]
                     for record in dividends if isinstance(record, dict)]

    warnings = []
    if data.get("price_source_error"):
        warnings.append("股价数据源本次更新失败，价格可能沿用上次数据。")
    if valuation.get("applicable") is False:
        warnings.append(valuation.get("reason") or "当前估值模型不适用。")
    gaps = data.get("price_range_gaps") if isinstance(data.get("price_range_gaps"), list) else []
    if gaps:
        warnings.append("以下年份的后一年股价范围缺失：{}。".format("、".join(str(item) for item in gaps)))
    recent_range = data.get("last_7_days_high_low")

    style = ("body{font-family:Arial,sans-serif;color:#1f2937}h2,h3{color:#1f4e79}"
             "table{border-collapse:collapse;margin:8px 0 18px;font-size:13px;max-width:100%}"
             "th,td{border:1px solid #d1d5db;padding:6px 9px;text-align:left;vertical-align:top}"
             "th{background:#eef3f8;white-space:nowrap}.wide{font-size:12px}.warn{color:#9a5b00}"
             ".footer{color:#6b7280;font-size:12px;margin-top:20px}")
    sections = [
        "<h2>选股详情 · {} {}</h2>".format(esc(code), esc(name)),
        "".join("<p class='warn'>{}</p>".format(esc(item)) for item in warnings),
        "<h3>基本判断</h3>" + table(["结果", "说明"], check_rows),
        "<h3>投资判断</h3>" + table(["项目", "内容"], opportunity_rows),
        "<h3>价值投资估值</h3>" + table(["项目", "数值"], summary_rows),
        "<h3>估值参数与计算明细</h3>" + table(["项目", "数值"], valuation_detail_rows),
        "<h3>估值敏感性</h3>" + (table(["情景", "每股价值", "安全边际"], sensitivity_rows)
                                   if sensitivity_rows else "<p>暂无敏感性数据。</p>"),
        "<h3>筹码与价格</h3>" + table(["项目", "数值"], chip_rows),
        "<h3>近期高低</h3><p>{}</p>".format(esc(
            json.dumps(recent_range, ensure_ascii=False) if isinstance(recent_range, (dict, list))
            else recent_range)),
        "<h3>财务指标</h3>" + table(["指标"] + columns, financial_rows, "wide"),
        "<h3>分红记录</h3>" + (table(dividend_headers, dividend_rows, "wide") if dividend_headers else "<p>暂无分红记录。</p>"),
        "<p class='footer'>数据来自家庭选股详情页的已保存 OneDrive 数据。<br>"
        "<a href='https://a.cnmas.top'>打开 Family Tracker</a></p>",
    ]
    document = "<html><head><meta charset='utf-8'><style>{}</style></head><body>{}</body></html>".format(
        style, "".join(sections))
    return document, "选股详情 · {} {}".format(code, name).strip()


def main():
    stock = canonical_stock(os.environ.get("STOCK_DETAIL_CODE"))
    sender = os.environ.get("STOCK_MAIL_FROM", "").strip()
    recipient = os.environ.get("STOCK_MAIL_TO", "").strip()
    if not sender or not recipient:
        raise RuntimeError("STOCK_MAIL_FROM / STOCK_MAIL_TO not set")
    proxy = op.load_config_cfg_env() if hasattr(op, "load_config_cfg_env") else None
    proxies = {"http": proxy, "https": proxy} if proxy else None
    os.environ.setdefault("ONEDRIVE_RT_READONLY", "1")
    drive = op.OneDrivePersonal(proxies=proxies, rt_readonly=True)
    raw = drive.get_text("output/{}.json".format(stock))
    if not raw:
        raise RuntimeError("stock output not found: {}".format(stock))
    data = json.loads(raw)
    settings_raw = drive.get_text("valuation-settings.json")
    if not settings_raw:
        raise RuntimeError("valuation-settings.json not found")
    settings = json.loads(settings_raw)
    if (not isinstance(settings, dict) or not isinstance(settings.get("defaults"), dict) or
            not isinstance(settings.get("stocks"), dict)):
        raise RuntimeError("valuation-settings.json structure invalid")
    body, subject = build_detail_html(data, settings)
    if not send_mail(body, subject, sender, recipient, proxies):
        raise RuntimeError("mail send failed")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # noqa: BLE001
        print("Stock detail mail error: {}: {}".format(type(error).__name__, error))
        sys.exit(1)
