#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge 'Stored Value Card.csv' + '奥体羽毛球.csv' into stored-value-cards.json.

Unified transaction model. Each record:
  { id, card, account, date, amount, expiry, note, createdBy, modified }
  amount: SIGNED change (充值 positive / 使用 negative).
  A card's current balance = sum of its amounts.

Source A - 'Stored Value Card.csv' (snapshot per card):
  Title, 储值账户, 充值金额, 本次花费, 剩余金额, 有效期
  -> ONE "初始余额" record per card: amount = 剩余金额, account, expiry.

Source B - '奥体羽毛球.csv' (ledger for one card):
  Title, DateT, 金额变动-充值正-使用负, 余额, ID
  -> ONE record per row: amount = 金额变动, date, card = Title.

Console note: Windows console is cp1252 -> we never print Chinese text.
"""
import csv, json, os, sys, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.dirname(ROOT)
SRC_CARD = os.path.join(BASE, "Stored Value Card.csv")
SRC_BADM = os.path.join(BASE, "奥体羽毛球.csv")
OUT = os.path.join(ROOT, "stored-value-cards.json")


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


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def rec(card, account, date, amount, expiry, note):
    return {
        "id": str(uuid.uuid4()),
        "card": card,
        "account": account,
        "date": date,
        "amount": r2(amount),
        "expiry": expiry,
        "note": note,
        "createdBy": "migration",
        "modified": now_iso(),
    }


def main():
    records = []

    # Source A: Stored Value Card snapshot -> initial-balance records.
    if os.path.exists(SRC_CARD):
        with open(SRC_CARD, "r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f))
        # header: Title, 储值账户, 充值金额, 本次花费, 剩余金额, 有效期
        for row in rows[1:]:
            if not row:
                continue
            while len(row) < 6:
                row.append("")
            card = (row[0] or "").strip().strip('"')
            account = (row[1] or "").strip().strip('"')
            balance = num(row[4])
            expiry = iso_date(row[5])
            if not card:
                continue
            records.append(rec(card, account, "", balance, expiry, "初始余额"))
    else:
        print("WARN: not found:", SRC_CARD)

    # Source B: 奥体羽毛球 ledger -> per-transaction records.
    if os.path.exists(SRC_BADM):
        with open(SRC_BADM, "r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f))
        # header: Title, DateT, 金额变动, 余额, ID
        for row in rows[1:]:
            if not row:
                continue
            while len(row) < 5:
                row.append("")
            card = (row[0] or "").strip().strip('"')
            date = iso_date(row[1])
            amount = num(row[2])
            if not card:
                continue
            records.append(rec(card, "", date, amount, "", ""))
    else:
        print("WARN: not found:", SRC_BADM)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False, indent=2)

    # Per-card balance summary (ASCII-only: print counts, not card names).
    bal = {}
    for r in records:
        bal[r["card"]] = bal.get(r["card"], 0) + r["amount"]
    print("Wrote", len(records), "records to", OUT)
    print("Cards:", len(bal))
    print("Total balance:", round(sum(bal.values()), 2))


if __name__ == "__main__":
    main()
