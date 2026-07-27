#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert 'Medical_Spending.csv' into medical-records.json for the 看病 tracker.

CSV columns (header, in Chinese):
  Title, Date, 个人支付, 医保统筹支付, 总计, 备注

Notes handled:
  - Numbers may carry thousands separators, e.g. "3,076.78".
  - 备注 fields may contain embedded newlines (multi-line quoted cells).
  - Dates are M/D/YYYY -> normalized to YYYY-MM-DD.
  - The CSV's 总计 value is preserved as-is (some rows have data-entry
    discrepancies vs 个人+医保); the app only auto-computes for NEW entries.

Output JSON: { "records": [ { id, title, date, personal, insurance, total,
  note, createdBy, modified }, ... ] }

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, json, os, sys, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                                   # spending-tracker/
SRC = os.path.join(os.path.dirname(ROOT), "Medical_Spending.csv")  # ..\Medical_Spending.csv
OUT = os.path.join(ROOT, "medical-records.json")               # upload to root of the dedicated Medical shared folder


def num(s):
    """Parse a quoted, comma-grouped number cell -> float (blank -> 0.0)."""
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


# Map a title prefix to the 看病人 (patient). 小朱 is the same person as 云天河.
PERSON_PREFIXES = [
    ("\u4e91\u5929\u6cb3", "\u4e91\u5929\u6cb3"),  # yun-tian-he
    ("\u5c0f\u6731", "\u4e91\u5929\u6cb3"),        # xiao-zhu  -> same person
    ("\u4e91\u6735", "\u4e91\u6735"),              # yun-duo
    ("\u5c0f\u9976", "\u5c0f\u9976"),              # xiao-rao
    ("\u6731\u7238\u7238", "\u6731\u7238\u7238"),  # zhu-ba-ba
]


def person_of(title):
    for prefix, name in PERSON_PREFIXES:
        if title.startswith(prefix):
            return name
    return ""


def iso_date(s):
    """M/D/YYYY -> YYYY-MM-DD (tolerant of a few formats)."""
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
    titles, years = set(), set()
    persons = {}

    with open(SRC, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        rows = list(reader)

    if not rows:
        print("ERROR: empty CSV")
        sys.exit(1)

    # Skip header row (rows[0]); columns: Title, Date, personal, insurance, total, note
    for row in rows[1:]:
        if not row:
            continue
        # Pad short rows so indexing is safe.
        while len(row) < 6:
            row.append("")
        title = (row[0] or "").strip().strip('"')
        date = iso_date(row[1])
        if not title and not date:
            continue
        personal = r2(num(row[2]))
        insurance = r2(num(row[3]))
        total = r2(num(row[4]))
        note = (row[5] or "").strip().strip('"')

        rec = {
            "id": str(uuid.uuid4()),
            "person": person_of(title),
            "title": title,
            "date": date,
            "personal": personal,
            "insurance": insurance,
            "total": total,
            "note": note,
            "createdBy": "migration",
            "modified": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        records.append(rec)
        if title:
            titles.add(title)
        if date[:4]:
            years.add(date[:4])
        persons[rec["person"]] = persons.get(rec["person"], 0) + 1

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)

    print("Wrote", len(records), "records to", OUT)
    print("Distinct titles:", len(titles))
    print("Years:", sorted(years))
    print("Persons:")
    for name, cnt in sorted(persons.items(), key=lambda kv: -kv[1]):
        print("  ", cnt, ascii(name))


if __name__ == "__main__":
    main()
