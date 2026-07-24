#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert 'Family Income.csv' into income-records.json for the income tracker.

CSV columns:
  Title, 收款人, 日期, 基本工资, 加班费, 奖金, 其他收入, 税前总收入,
  社保扣除, 公积金扣除, 个人所得税扣除, 实际收入金额, 备注, Year1, Month1

Output JSON: { "records": [ { id, title, payee, date, baseSalary, overtime,
  bonus, otherIncome, grossTotal, socialSecurity, housingFund, incomeTax,
  netAmount, note, createdBy, modified }, ... ] }

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, json, os, sys, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # spending-tracker/
SRC = os.path.join(os.path.dirname(ROOT), "Family Income.csv")  # ..\Family Income.csv
OUT = os.path.join(ROOT, "income-records.json")         # spending-tracker\income-records.json (upload to OneDrive)


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


def main():
    if not os.path.exists(SRC):
        print("ERROR: source CSV not found:", SRC)
        sys.exit(1)

    records = []
    titles, payees, years = set(), set(), set()

    with open(SRC, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            title = (row.get("Title") or "").strip().strip('"')
            payee = (row.get("\u6536\u6b3e\u4eba") or "").strip().strip('"')
            date = iso_date(row.get("\u65e5\u671f"))
            if not title and not date:
                continue
            rec = {
                "id": str(uuid.uuid4()),
                "title": title,
                "payee": payee,
                "date": date,
                "baseSalary": num(row.get("\u57fa\u672c\u5de5\u8d44")),
                "overtime": num(row.get("\u52a0\u73ed\u8d39")),
                "bonus": num(row.get("\u5956\u91d1")),
                "otherIncome": num(row.get("\u5176\u4ed6\u6536\u5165")),
                "grossTotal": num(row.get("\u7a0e\u524d\u603b\u6536\u5165")),
                "socialSecurity": num(row.get("\u793e\u4fdd\u6263\u9664")),
                "housingFund": num(row.get("\u516c\u79ef\u91d1\u6263\u9664")),
                "incomeTax": num(row.get("\u4e2a\u4eba\u6240\u5f97\u7a0e\u6263\u9664")),
                "netAmount": num(row.get("\u5b9e\u9645\u6536\u5165\u91d1\u989d")),
                "note": (row.get("\u5907\u6ce8") or "").strip().strip('"'),
                "createdBy": "migration",
                "modified": datetime.datetime.utcnow().isoformat() + "Z",
            }
            records.append(rec)
            if title:
                titles.add(title)
            if payee:
                payees.add(payee)
            if date[:4]:
                years.add(date[:4])

    # Newest first is nice but the app sorts anyway; keep CSV order.
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)

    print("Wrote", len(records), "records to", OUT)
    print("Distinct titles:", len(titles))
    print("Distinct payees:", len(payees))
    print("Years:", sorted(years))
    # Emit the base lists as JSON so we can paste into app.js (ASCII-safe).
    side = os.path.join(HERE, "income_baselists.json")
    with open(side, "w", encoding="utf-8") as f:
        json.dump({
            "titles": sorted(titles),
            "payees": sorted(payees),
            "years": sorted(years),
        }, f, ensure_ascii=False, indent=2)
    print("Base lists ->", side)


if __name__ == "__main__":
    main()
