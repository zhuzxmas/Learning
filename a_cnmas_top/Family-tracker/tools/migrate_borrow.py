#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert 'Borrow-Repay.csv' into borrow-repay.json for the 借还款 tracker.

CSV columns (header):
  Title, DateT, Borrow-Negative-Repay-Positive

Notes:
  - Title is the person name.
  - Amount is a SIGNED value: negative = 借出, positive = 还款.
  - Amount may carry thousands separators, e.g. "-180,000".
  - Dates are M/D/YYYY -> normalized to YYYY-MM-DD.
  - CSV has no remark column -> note is empty on migration.

Output JSON: { "records": [ { id, person, date, amount, note, createdBy, modified }, ... ] }

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, json, os, sys, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                                    # spending-tracker/
SRC = os.path.join(os.path.dirname(ROOT), "Borrow-Repay.csv")  # ..\Borrow-Repay.csv
OUT = os.path.join(ROOT, "borrow-repay.json")                  # upload to the shared 新模块 folder


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
    persons = set()
    lent = repaid = 0

    # Skip header; columns: Title(person), Date, amount(signed)
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < 3:
            row.append("")
        person = (row[0] or "").strip().strip('"')
        date = iso_date(row[1])
        amount = r2(num(row[2]))
        if not date and amount == 0 and not person:
            continue

        records.append({
            "id": str(uuid.uuid4()),
            "person": person,
            "date": date,
            "amount": amount,
            "note": "",
            "createdBy": "migration",
            "modified": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        })
        if date[:4]:
            years.add(date[:4])
        if person:
            persons.add(person)
        if amount < 0:
            lent += amount
        else:
            repaid += amount

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)

    print("Wrote", len(records), "records to", OUT)
    print("Years:", sorted(years))
    print("Persons:", len(persons))
    print("Sum lent   (-):", round(lent, 2))
    print("Sum repaid (+):", round(repaid, 2))
    print("Net:", round(lent + repaid, 2))


if __name__ == "__main__":
    main()
