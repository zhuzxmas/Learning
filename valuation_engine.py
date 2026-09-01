"""Auditable asset-value and earnings-power-value calculations."""

from __future__ import annotations

import math
import statistics


DEFAULT_ASSUMPTIONS = {
    "cash": 1.0,
    "securities": 1.0,
    "receivables": 1.0,
    "inventory": 1.0,
    "fixed_assets": 1.0,
    "intangibles": 0.0,
    "goodwill": 0.0,
    "other_assets": 1.0,
    "capitalization_rate": 0.10,
    "fallback_tax_rate": 0.25,
}

FINANCIAL_KEYWORDS = ("银行", "保险", "证券", "券商", "金融企业")


def _number(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _median(values):
    clean = [value for value in (_number(item) for item in values) if value is not None]
    return statistics.median(clean) if clean else None


def _round(value):
    return None if value is None else math.floor(value * 100 + 0.5) / 100


def is_financial_company(industry=None, org_type=None):
    text = "%s %s" % (industry or "", org_type or "")
    return any(word in text for word in FINANCIAL_KEYWORDS)


def calculate(periods, assumptions=None, industry=None, org_type=None,
              current_price=None, currency="CNY", snapshot=None):
    """Calculate AV and EPV from newest-first annual periods.

    Monetary inputs use full currency units. Missing required inputs produce an
    explicit incomplete result; they are never silently treated as zero.
    """
    settings = dict(DEFAULT_ASSUMPTIONS)
    settings.update(assumptions or {})
    if is_financial_company(industry, org_type):
        return {
            "applicable": False,
            "reason": "当前 AV/EPV 模型不适用于金融企业。",
            "industry": industry,
            "org_type": org_type,
        }
    rows = [dict(row) for row in periods if isinstance(row, dict)]
    if not rows:
        return {"applicable": True, "complete": False, "missing": ["annual_periods"]}
    latest = dict(snapshot) if isinstance(snapshot, dict) else rows[0]
    latest_annual = rows[0]
    missing = []

    def required(name):
        value = _number(latest.get(name))
        if value is None:
            missing.append(name)
        return value

    shares = required("shares")
    if shares is not None and shares <= 0:
        missing.append("shares")
    total_assets = required("total_assets")
    total_liabilities = required("total_liabilities")
    cash = required("cash")
    receivables = required("receivables")
    inventory = required("inventory")
    fixed_assets = required("fixed_assets")
    securities = required("securities")
    intangibles = required("intangibles")
    goodwill = required("goodwill")
    minority_interest = required("minority_interest")
    debt = _number(latest.get("interest_bearing_debt"))
    known_assets = [cash, securities, receivables, inventory, fixed_assets,
                    intangibles, goodwill]
    residual_assets = (None if total_assets is None or any(value is None for value in known_assets)
                       else total_assets - sum(known_assets))
    if residual_assets is not None and residual_assets < -max(total_assets * .01, 1):
        missing.append("overlapping_asset_categories")
    other_assets = None if residual_assets is None else max(0.0, residual_assets)

    asset_value = None
    if not missing:
        adjusted_assets = (
            cash * settings["cash"]
            + securities * settings["securities"]
            + receivables * settings["receivables"]
            + inventory * settings["inventory"]
            + fixed_assets * settings["fixed_assets"]
            + intangibles * settings["intangibles"]
            + goodwill * settings["goodwill"]
            + other_assets * settings["other_assets"]
        )
        equity_value = adjusted_assets - total_liabilities - minority_interest
        asset_value = {
            "adjusted_assets": _round(adjusted_assets),
            "equity_value": _round(equity_value),
            "per_share": _round(equity_value / shares) if shares > 0 else None,
            "other_assets": _round(other_assets),
        }

    annual = rows[:7]
    margins = []
    tax_rates = []
    depreciation = []
    for row in annual:
        revenue = _number(row.get("revenue"))
        ebit = _number(row.get("ebit"))
        pretax = _number(row.get("pretax_profit"))
        tax = _number(row.get("income_tax"))
        da = _number(row.get("depreciation_amortization"))
        if revenue and revenue > 0 and ebit is not None:
            margins.append(ebit / revenue)
        if pretax and pretax > 0 and tax is not None:
            rate = tax / pretax
            if 0 <= rate <= 0.60:
                tax_rates.append(rate)
        if da is not None and da >= 0:
            depreciation.append(da)

    normalized_margin = _median(margins)
    tax_rate = _median(tax_rates)
    if tax_rate is None:
        tax_rate = settings["fallback_tax_rate"]
    normalized_da = _median(depreciation)
    latest_revenue = _number(latest_annual.get("revenue"))
    cap_rate = _number(settings.get("capitalization_rate"))
    epv_missing = []
    for name, value in (("shares", shares), ("revenue", latest_revenue),
                        ("normalized_ebit_margin", normalized_margin),
                        ("capitalization_rate", cap_rate),
                        ("cash", cash), ("interest_bearing_debt", debt),
                        ("securities", securities),
                        ("minority_interest", minority_interest),
                        ("normalized_depreciation_amortization", normalized_da)):
        if value is None or (name in ("shares", "capitalization_rate") and value <= 0):
            epv_missing.append(name)
    epv = None
    if not epv_missing:
        normalized_ebit = latest_revenue * normalized_margin
        after_tax_earnings = normalized_ebit * (1 - tax_rate)
        # Under the selected no-growth assumption, maintenance capex equals D&A.
        maintenance_capex = normalized_da
        normalized_operating_earnings = after_tax_earnings + normalized_da - maintenance_capex
        operating_value = normalized_operating_earnings / cap_rate
        equity_value = operating_value + cash + securities - debt - minority_interest
        epv = {
            "normalized_ebit_margin": round(normalized_margin, 6),
            "normalized_ebit": _round(normalized_ebit),
            "effective_tax_rate": round(tax_rate, 6),
            "normalized_depreciation_amortization": _round(normalized_da),
            "maintenance_capex": _round(maintenance_capex),
            "normalized_operating_earnings": _round(normalized_operating_earnings),
            "operating_value": _round(operating_value),
            "equity_value": _round(equity_value),
            "per_share": _round(equity_value / shares),
        }

    price = _number(current_price)
    comparison = None
    if price is not None:
        av_per_share = asset_value and asset_value.get("per_share")
        epv_per_share = epv and epv.get("per_share")
        comparison = {
            "current_price": price,
            "asset_margin_of_safety": (
                round(1 - price / av_per_share, 6) if av_per_share and av_per_share > 0 else None),
            "epv_margin_of_safety": (
                round(1 - price / epv_per_share, 6) if epv_per_share and epv_per_share > 0 else None),
            "epv_minus_asset_value": (
                _round(epv_per_share - av_per_share)
                if epv_per_share is not None and av_per_share is not None else None),
        }

    return {
        "applicable": True,
        "complete": asset_value is not None and epv is not None,
        "currency": currency,
        "periods_used": len(annual),
        "as_of": latest_annual.get("date"),
        "snapshot_as_of": latest.get("date"),
        "industry": industry,
        "org_type": org_type,
        "missing": sorted(set(missing + epv_missing)),
        "raw": latest,
        "assumptions": settings,
        "asset_value": asset_value,
        "epv": epv,
        "comparison": comparison,
    }
