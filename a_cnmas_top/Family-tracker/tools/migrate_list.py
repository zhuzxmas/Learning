#!/usr/bin/env python3
"""Convert a Microsoft List export (CSV) into records.json for the spending app.

Usage:
    python migrate_list.py <export.csv> [output.json]

- Input: a CSV exported from the Microsoft List ("Export to CSV" in the List
  toolbar, or "Export to Excel" then Save As CSV UTF-8).
- Output: records.json in the shape the web app expects. Default output path is
  ../records.json next to this tools/ folder.

Column mapping (header name in export -> record field):
    一级分类       -> i_cat
    二级分类       -> ii_cat
    三级分类       -> iii_cat
    金额           -> amount
    日期           -> date   (normalized to YYYY-MM-DD)
    备注           -> note
    Created By     -> createdBy
    Modified       -> modified

Header matching is case-insensitive and tolerant of extra spaces. English
fall-back names (I_Cat/II_Cat/III_Cat/Amount/Date/Note) are also accepted.
"""
import csv, io, json, os, sys, uuid, re
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))

# Candidate header names for each field (first match wins).
HEADER_ALIASES = {
    "i_cat":    ["一级分类", "I_Cat", "ICat", "一级"],
    "ii_cat":   ["二级分类", "II_Cat", "IICat", "二级"],
    "iii_cat":  ["三级分类", "III_Cat", "IIICat", "三级"],
    "amount":   ["金额", "Amount", "金额(元)", "金额（元）"],
    "date":     ["日期", "Date"],
    "note":     ["备注", "Note", "Remark", "Remarks"],
    "createdBy":["Created By", "Recorded by", "Recorded By", "创建者", "记录人", "Author", "CreatedBy"],
    "modified": ["Modified", "修改时间", "Modified Date"],
}


def norm(s):
    return re.sub(r"\s+", "", (s or "")).strip().lower()


def build_header_map(fieldnames):
    """Map each record field to the actual CSV column name present."""
    present = {norm(fn): fn for fn in fieldnames if fn is not None}
    mapping = {}
    for field, aliases in HEADER_ALIASES.items():
        for a in aliases:
            if norm(a) in present:
                mapping[field] = present[norm(a)]
                break
    return mapping


def parse_amount(v):
    if v is None:
        return 0.0
    s = str(v).replace(",", "").replace("¥", "").replace("￥", "").strip()
    if s == "":
        return 0.0
    try:
        return round(float(s), 2)
    except ValueError:
        return 0.0


DATE_FORMATS = [
    "%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y",
    "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S",
    "%m/%d/%Y %H:%M", "%m/%d/%Y %I:%M %p",
]


def parse_date(v):
    if not v:
        return ""
    s = str(v).strip()
    # ISO with timezone / fractional seconds -> take the date part
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # last resort: leave as-is
    return s


def convert_csv(in_path, records):
    """Read one CSV file and append converted records to the given list.
    Returns (converted_count, skipped_count)."""
    with io.open(in_path, "r", encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        # Auto-detect delimiter (comma or tab), default to comma.
        delim = ","
        try:
            delim = csv.Sniffer().sniff(sample, delimiters=",\t;").delimiter
        except csv.Error:
            if "\t" in sample and sample.count("\t") > sample.count(","):
                delim = "\t"
        reader = csv.DictReader(f, delimiter=delim)
        if not reader.fieldnames:
            print(f"ERROR: no header row in {in_path}")
            sys.exit(1)
        hmap = build_header_map(reader.fieldnames)

        required = ["i_cat", "ii_cat", "iii_cat", "amount", "date"]
        missing = [r for r in required if r not in hmap]
        if missing:
            print(f"ERROR ({in_path}): could not find columns for:", ", ".join(missing))
            print("CSV headers were:", reader.fieldnames)
            sys.exit(1)

        converted = 0
        skipped = 0
        for row in reader:
            i = (row.get(hmap["i_cat"], "") or "").strip()
            ii = (row.get(hmap["ii_cat"], "") or "").strip()
            iii = (row.get(hmap["iii_cat"], "") or "").strip()
            date = parse_date(row.get(hmap["date"], ""))
            amount = parse_amount(row.get(hmap["amount"], ""))
            if not (i and ii and iii and date):
                skipped += 1
                continue
            rec = {
                "id": str(uuid.uuid4()),
                "i_cat": i,
                "ii_cat": ii,
                "iii_cat": iii,
                "amount": amount,
                "date": date,
                "note": (row.get(hmap.get("note", ""), "") or "").strip() if "note" in hmap else "",
                "createdBy": (row.get(hmap.get("createdBy", ""), "") or "").strip() if "createdBy" in hmap else "",
                "modified": parse_date(row.get(hmap.get("modified", ""), "")) if "modified" in hmap else "",
            }
            records.append(rec)
            converted += 1
    return converted, skipped


def main():
    if len(sys.argv) < 2:
        print("Usage: python migrate_list.py <export1.csv> [export2.csv ...] [--out output.json]")
        sys.exit(1)

    args = sys.argv[1:]
    out_path = os.path.join(HERE, "..", "records.json")
    inputs = []
    i = 0
    while i < len(args):
        if args[i] == "--out":
            out_path = args[i + 1]
            i += 2
        else:
            inputs.append(args[i])
            i += 1

    records = []
    total_conv = 0
    total_skip = 0
    for path in inputs:
        c, s = convert_csv(path, records)
        total_conv += c
        total_skip += s
        print(f"  {os.path.basename(path)}: converted {c}, skipped {s}")

    out = {"records": records}
    with io.open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Wrote {os.path.abspath(out_path)}")
    print(f"TOTAL converted: {total_conv}; skipped (incomplete): {total_skip}")
    dates = [r["date"] for r in records if r["date"]]
    if dates:
        print(f"Date range: {min(dates)} .. {max(dates)}")


if __name__ == "__main__":
    main()
