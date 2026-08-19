#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert Travel Record.csv into travel.json (for the web app's 旅行 module).

CSV columns:
  Title, Date, Latitude, Longitude, Remark, People
  People is a semicolon-separated list, e.g. "Nathan Zhu CN;Celine Rao CN".
  Trailing 2-letter country suffixes (" CN") are stripped so the app's person
  checkboxes (Nathan Zhu / Celine Rao / Cloud Zhu) match directly.

Output: travel.json  (upload to the shared OtherTracker OneDrive folder)

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, datetime, json, os, re, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.dirname(os.path.dirname(ROOT))
SRC = os.path.join(BASE, "Travel Record.csv")
OUT = os.path.join(ROOT, "travel.json")

COUNTRY_SUFFIX = re.compile(r"\s+[A-Za-z]{2}$")


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


def norm_people(s):
    out = []
    if not s:
        return out
    for name in str(s).split(";"):
        n = COUNTRY_SUFFIX.sub("", name.strip())
        if n and n not in out:
            out.append(n)
    return out


def main():
    if not os.path.exists(SRC):
        print("ERROR: source CSV not found:", SRC)
        raise SystemExit(1)
    with open(SRC, "r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    records = []
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < 6:
            row.append("")
        title = (row[0] or "").strip().strip('"')
        date = iso_date(row[1])
        latitude = opt_float(row[2])
        longitude = opt_float(row[3])
        remark = (row[4] or "").strip().strip('"')
        if remark in ("-", "--"):
            remark = ""
        people = norm_people(row[5])
        if not title and latitude is None and longitude is None:
            continue
        records.append({
            "id": str(uuid.uuid4()),
            "title": title,
            "date": date,
            "latitude": latitude,
            "longitude": longitude,
            "remark": remark,
            "people": people,
            "createdBy": "migration",
            "modified": now_iso(),
        })
    records.sort(key=lambda r: (r.get("date") or "", r.get("title") or ""), reverse=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)
    names = sorted({n for r in records for n in r["people"]})
    print("Travel: wrote", len(records), "records to", OUT)
    print("People:", len(names))


if __name__ == "__main__":
    main()