#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert family health CSVs into health-weight.json and health-bp.json.

Weight CSV (Family Weight.csv):
  Title, DateV, Weight_kg, Height_cm, BMI_Auto_Calculated, Remark
  -> {id,person,date,weight,height(int|null),bmi(float|null),note,...}
  BMI is recomputed from weight & height when both present.

Blood-pressure CSV (Family Blood Pressure.csv):
  Title, DateV, 收缩压_mmHg, 舒张压_mmHg, 脉搏_Rap_Min, Note
  -> {id,person,date,systolic(int|null),diastolic(int|null),pulse(int|null),note,...}

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, json, os, sys, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.dirname(ROOT)
SRC_W = os.path.join(BASE, "Family Weight.csv")
SRC_B = os.path.join(BASE, "Family Blood Pressure.csv")
OUT_W = os.path.join(ROOT, "health-weight.json")
OUT_B = os.path.join(ROOT, "health-bp.json")


def opt_float(s):
    if s is None:
        return None
    t = str(s).strip().strip('"').replace(",", "")
    if t == "" or t in ("-", "--"):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def opt_int(s):
    v = opt_float(s)
    return int(round(v)) if v is not None else None


def r1(x):
    return float(f"{x:.1f}")


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


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def load(path):
    if not os.path.exists(path):
        print("ERROR: source CSV not found:", path)
        sys.exit(1)
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return list(csv.reader(f))


def migrate_weight():
    rows = load(SRC_W)
    records = []
    # header: Title, DateV, Weight_kg, Height_cm, BMI, Remark
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < 6:
            row.append("")
        person = (row[0] or "").strip().strip('"')
        date = iso_date(row[1])
        weight = opt_float(row[2])
        height = opt_int(row[3])
        note = (row[5] or "").strip().strip('"')
        if note in ("-", "--"):
            note = ""
        if not person and weight is None and not date:
            continue
        bmi = None
        if weight is not None and height:
            m = height / 100.0
            if m > 0:
                bmi = r1(weight / (m * m))
        records.append({
            "id": str(uuid.uuid4()),
            "person": person,
            "date": date,
            "weight": r1(weight) if weight is not None else None,
            "height": height,
            "bmi": bmi,
            "note": note,
            "createdBy": "migration",
            "modified": now_iso(),
        })
    with open(OUT_W, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)
    persons = sorted({r["person"] for r in records if r["person"]})
    print("Weight: wrote", len(records), "records; persons:", len(persons))


def migrate_bp():
    rows = load(SRC_B)
    records = []
    # header: Title, DateV, systolic, diastolic, pulse, Note
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < 6:
            row.append("")
        person = (row[0] or "").strip().strip('"')
        date = iso_date(row[1])
        systolic = opt_int(row[2])
        diastolic = opt_int(row[3])
        pulse = opt_int(row[4])
        note = (row[5] or "").strip().strip('"')
        if note in ("-", "--"):
            note = ""
        if not person and systolic is None and diastolic is None and not date:
            continue
        records.append({
            "id": str(uuid.uuid4()),
            "person": person,
            "date": date,
            "systolic": systolic,
            "diastolic": diastolic,
            "pulse": pulse,
            "note": note,
            "createdBy": "migration",
            "modified": now_iso(),
        })
    with open(OUT_B, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)
    persons = sorted({r["person"] for r in records if r["person"]})
    print("BP: wrote", len(records), "records; persons:", len(persons))


def main():
    migrate_weight()
    migrate_bp()


if __name__ == "__main__":
    main()
