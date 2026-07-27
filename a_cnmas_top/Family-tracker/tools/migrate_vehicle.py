#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert 'Vehicle Maintenance.csv' into vehicle-maintenance.json.

CSV columns (header):
  Title, DateV, Cost, Category, Odm, Remark

Field mapping -> record:
  vehicle  <- Title      (vehicle name)
  date     <- DateV      (M/D/YYYY -> YYYY-MM-DD)
  cost     <- Cost       (money)
  category <- Category   (maintenance type)
  odometer <- Odm        (integer km; blank -> null)
  note     <- Remark

Output JSON: { "records": [ { id,vehicle,date,cost,category,odometer,note,
                              createdBy,modified }, ... ] }

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, json, os, sys, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "Vehicle Maintenance.csv")
OUT = os.path.join(ROOT, "vehicle-maintenance.json")


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


def opt_int(s):
    if s is None:
        return None
    t = str(s).strip().strip('"').replace(",", "")
    if t == "" or t in ("-", "--"):
        return None
    try:
        return int(round(float(t)))
    except ValueError:
        return None


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
    cost_sum = 0.0

    # header: Title, DateV, Cost, Category, Odm, Remark
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < 6:
            row.append("")
        vehicle = (row[0] or "").strip().strip('"')
        date = iso_date(row[1])
        cost = r2(num(row[2]))
        category = (row[3] or "").strip().strip('"')
        odometer = opt_int(row[4])
        note = (row[5] or "").strip().strip('"')
        if note in ("-", "--"):
            note = ""
        if not vehicle and cost == 0 and not date:
            continue

        records.append({
            "id": str(uuid.uuid4()),
            "vehicle": vehicle,
            "date": date,
            "cost": cost,
            "category": category,
            "odometer": odometer,
            "note": note,
            "createdBy": "migration",
            "modified": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        })
        if date[:4]:
            years.add(date[:4])
        cost_sum += cost

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)

    print("Wrote", len(records), "records to", OUT)
    print("Years:", sorted(years))
    print("Sum cost:", round(cost_sum, 2))


if __name__ == "__main__":
    main()
