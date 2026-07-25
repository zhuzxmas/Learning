#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert 'Stock Invest.csv' into stock-records.json for the stock tracker.

CSV columns:
  股票代码, 交易价格, 交易股数, 汇率, 总金额, 交易时间, 交易账户,
  成交金额, 佣金, 印花税, 过户费

Derived fields are RE-COMPUTED here (the CSV derived columns are not trusted).
H-share detection: code[0] == 'H'.

Output JSON: { "records": [ { id, code, price, shares, fx, date, account,
  amount, commission, stampTax, transferFee, total, createdBy, modified }, ... ] }

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, json, os, sys, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # spending-tracker/
SRC = os.path.join(os.path.dirname(ROOT), "Stock Invest.csv")  # ..\Stock Invest.csv
OUT = os.path.join(ROOT, "stock-records.json")     # spending-tracker\stock-records.json (upload to OneDrive)


def num(s):
    """Parse a quoted, comma-grouped number cell -> float (blank -> 0.0)."""
    if s is None:
        return 0.0
    s = s.strip().strip('"').replace(",", "")
    if s == "":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def iso_date(s):
    """M/D/YYYY -> YYYY-MM-DD."""
    s = (s or "").strip().strip('"')
    if not s:
        return ""
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s


def r2(x):
    """Round half up-ish to 2 decimals (Python round is banker's; use explicit)."""
    return float(f"{x:.2f}")


def compute(code, price, shares, fx):
    """Return (amount, commission, stampTax, transferFee, total) rounded to 2dp.
    Intermediate values are kept unrounded; total sums the unrounded parts.
    """
    is_h = bool(code) and code[0] == "H"
    if is_h:
        rate = fx if fx else 1.0
        amt = price * shares * rate
    else:
        amt = price * shares

    if is_h:
        if amt < -25000:
            comm = amt * 0.0002
        elif amt < 25000:
            comm = -5.0
        else:
            comm = -amt * 0.0002
    else:
        if amt < -50000:
            comm = amt * 0.0001
        elif amt < 50000:
            comm = -5.0
        else:
            comm = -amt * 0.0001

    if is_h:
        stamp = amt * 0.001127 if shares <= 0 else -amt * 0.001127
    else:
        stamp = 0.0 if shares <= 0 else -amt * 0.0005

    if is_h:
        transfer = 0.0
    else:
        transfer = amt * 0.00001 if shares <= 0 else -amt * 0.00001

    total = amt + comm + stamp + transfer
    return r2(amt), r2(comm), r2(stamp), r2(transfer), r2(total)


def main():
    if not os.path.exists(SRC):
        print("ERROR: source CSV not found:", SRC)
        sys.exit(1)

    records = []
    accounts, codes, years = set(), set(), set()

    with open(SRC, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = (row.get("\u80a1\u7968\u4ee3\u7801") or "").strip().strip('"')
            date = iso_date(row.get("\u4ea4\u6613\u65f6\u95f4"))
            if not code and not date:
                continue
            price = num(row.get("\u4ea4\u6613\u4ef7\u683c"))
            shares = num(row.get("\u4ea4\u6613\u80a1\u6570"))
            fx = num(row.get("\u6c47\u7387"))
            account = (row.get("\u4ea4\u6613\u8d26\u6237") or "").strip().strip('"')

            amount, commission, stampTax, transferFee, total = compute(code, price, shares, fx)

            rec = {
                "id": str(uuid.uuid4()),
                "code": code,
                "price": price,
                "shares": shares,
                "fx": fx if fx else (0 if code[:1] != "H" else fx),
                "date": date,
                "account": account,
                "amount": amount,
                "commission": commission,
                "stampTax": stampTax,
                "transferFee": transferFee,
                "total": total,
                "createdBy": "migration",
                "modified": datetime.datetime.utcnow().isoformat() + "Z",
            }
            records.append(rec)
            if account:
                accounts.add(account)
            if code:
                codes.add(code)
            if date[:4]:
                years.add(date[:4])

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)

    print("Wrote", len(records), "records to", OUT)
    print("Distinct accounts:", len(accounts))
    print("Distinct codes:", len(codes))
    print("Years:", sorted(years))
    side = os.path.join(HERE, "stock_baselists.json")
    with open(side, "w", encoding="utf-8") as f:
        json.dump({
            "accounts": sorted(accounts),
            "codes": sorted(codes),
            "years": sorted(years),
        }, f, ensure_ascii=False, indent=2)
    print("Base lists ->", side)


if __name__ == "__main__":
    main()
