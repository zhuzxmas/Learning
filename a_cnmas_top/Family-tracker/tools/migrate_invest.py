#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert 'Low Risk Invest.csv' into invest.json for the 理财 tracker.

CSV columns (header):
  Title, 交易金额, 利率, 合约期限, 到期收益, 购买时间, 备注

Field mapping -> record:
  name  <- Title           (product name)
  amount<- 交易金额         (principal)
  rate  <- 利率            (percent number, "2.2%" -> 2.2; blank -> null)
  term  <- 合约期限         (days integer; blank -> null)
  earn  <- 到期收益         (maturity earnings)
  date  <- 购买时间         (M/D/YYYY -> YYYY-MM-DD)
  note  <- 备注

Output JSON: { "records": [ { id,name,date,amount,rate,term,earn,note,createdBy,modified }, ... ] }

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, json, os, sys, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "Low Risk Invest.csv")
OUT = os.path.join(ROOT, "invest.json")


def num(s):
    if s is None:
        return 0.0
    s = str(s).strip().strip('"').replace(",", "").replace("%", "")
    if s == "":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def opt_num(s):
    """Return a number or None when blank."""
    if s is None:
        return None
    t = str(s).strip().strip('"').replace(",", "").replace("%", "")
    if t == "" or t in ("-", "--"):
        return None
    try:
        return float(t)
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
    amt_sum = earn_sum = 0.0

    # header: Title, 交易金额, 利率, 合约期限, 到期收益, 购买时间, 备注
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < 7:
            row.append("")
        name = (row[0] or "").strip().strip('"')
        amount = r2(num(row[1]))
        rate = opt_num(row[2])
        term = opt_num(row[3])
        term = int(term) if term is not None else None
        earn = r2(num(row[4]))
        date = iso_date(row[5])
        note = (row[6] or "").strip().strip('"')
        if note in ("-", "--"):
            note = ""
        if not name and amount == 0 and earn == 0 and not date:
            continue

        records.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "date": date,
            "amount": amount,
            "rate": rate,
            "term": term,
            "earn": earn,
            "note": note,
            "createdBy": "migration",
            "modified": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        })
        if date[:4]:
            years.add(date[:4])
        amt_sum += amount
        earn_sum += earn

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)

    print("Wrote", len(records), "records to", OUT)
    print("Years:", sorted(years))
    print("Sum amount:", round(amt_sum, 2))
    print("Sum earn:", round(earn_sum, 2))


if __name__ == "__main__":
    main()
