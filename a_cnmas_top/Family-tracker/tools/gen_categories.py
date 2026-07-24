#!/usr/bin/env python3
"""Generate public/categories.js from SpendingCat.csv, preserving first-appearance
order at every level (ordering driven by the CSV row order / ID)."""
import csv, json, os, io

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, "..", "..", "SpendingCat.csv")
OUT_PATH = os.path.join(HERE, "..", "public", "categories.js")

# ordered dict: i_cat -> ordered dict: ii_cat -> ordered list of iii_cat
tree = {}
with io.open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        i = (row["I_Cat"] or "").strip()
        ii = (row["II_Cat"] or "").strip()
        iii = (row["III_Cat"] or "").strip()
        if not i:
            continue
        tree.setdefault(i, {})
        tree[i].setdefault(ii, [])
        if iii and iii not in tree[i][ii]:
            tree[i][ii].append(iii)

payload = json.dumps(tree, ensure_ascii=False, indent=2)
js = (
    "// AUTO-GENERATED from SpendingCat.csv by tools/gen_categories.py\n"
    "// Order = first appearance in the CSV (driven by the ID column).\n"
    "// To regenerate: python tools/gen_categories.py\n"
    "window.CATEGORIES = " + payload + ";\n"
)
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with io.open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
    f.write(js)

i_count = len(tree)
ii_count = sum(len(v) for v in tree.values())
iii_count = sum(len(l) for v in tree.values() for l in v.values())
print(f"Wrote {OUT_PATH}")
print(f"Level-1: {i_count}, Level-2: {ii_count}, Level-3: {iii_count}")
