#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert 'Celine_Income.csv' into celine-income.json for the Celine 收入 tracker.

CSV columns (header):
  Title, DateT, Income_Pos_Spend_Neg, Remark

Notes:
  - Amount is a SIGNED value: positive = 收入, negative = 支出.
  - Amount may carry thousands separators, e.g. "180,000".
  - Dates are M/D/YYYY -> normalized to YYYY-MM-DD.
  - Remark may be blank.

Output JSON: { "records": [ { id, date, amount, note, createdBy, modified }, ... ] }

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, json, os, sys, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                                    # spending-tracker/
SRC = os.path.join(os.path.dirname(ROOT), "Celine_Income.csv")  # ..\Celine_Income.csv
OUT = os.path.join(ROOT, "celine-income.json")                  # upload to the shared 新模块 folder


def num(s):
    if s is None:
        return 0.0
    s = str(s).strip().strip('"').replace(",", "")
    if s == "":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def r2(x):
    return float(f"{x:.2f}")


def iso_date(s):
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

    with open(SRC, "r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))

    if not rows:
        print("ERROR: empty CSV")
        sys.exit(1)

    records = []
    years = set()
    pos = neg = 0

    # Skip header; columns: Title, Date, amount(signed), note
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < 4:
            row.append("")
        date = iso_date(row[1])
        amount = r2(num(row[2]))
        note = (row[3] or "").strip().strip('"')
        if not date and amount == 0 and not note:
            continue

        records.append({
            "id": str(uuid.uuid4()),
            "date": date,
            "amount": amount,
            "note": note,
            "createdBy": "migration",
            "modified": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        })
        if date[:4]:
            years.add(date[:4])
        if amount >= 0:
            pos += amount
        else:
            neg += amount

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)

    print("Wrote", len(records), "records to", OUT)
    print("Years:", sorted(years))
    print("Sum income (+):", round(pos, 2))
    print("Sum spend  (-):", round(neg, 2))
    print("Net:", round(pos + neg, 2))


if __name__ == "__main__":
    main()
