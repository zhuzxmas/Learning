#!/usr/bin/env python3
"""One-off migration: merge history/Saved_files_python/*-Y-*.pkl into the
current history/*-Y-*.pkl files, then delete the Saved_files_python folder.

Merge rule (yearly only):
  * Match by "{stock}.{ss|sz}-Y-" code prefix (filenames' Chinese name may
    differ); output keeps the *current* file's name.
  * For report-date columns with year < 2026, the Saved_files_python values are
    authoritative and overwrite/insert into the current file. Columns for
    2026+ (and any current-only column such as the latest 2025 report the
    Saved copy lacks) are kept from the current file.
  * Index = union, ordered as Saved's index first (so its extra dividend rows
    are captured), then any current-only rows appended.
  * The '每股利润增长率 x 100%' row is recomputed from the merged EPS row,
    mirroring finance_batch_personal.process_reports.

Scope / skips: yearly (-Y-) only; skips monthly (-M-), the Ford file, the stray
xlsx, and any Saved stock that has no matching current history file.

Usage:
  python migrate_saved_files.py            # dry-run: print diffs, write nothing
  python migrate_saved_files.py --apply    # write merged pkls + delete folder

Local runs default to ONEDRIVE_RT_READONLY=1 (via config.cfg), so rt.enc is
never rewritten; pkl writes, however, are REAL writes to OneDrive.
"""

import configparser
import os
import sys

_stream = getattr(sys.stdout, "reconfigure", None)
if _stream:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

import pandas as pd

from onedrive_personal import OneDrivePersonal

SAVED_DIR = "history/Saved_files_python"
# Columns whose report year is >= this always come from the CURRENT file;
# Saved_files_python is authoritative only for years strictly below it
# (i.e. Saved overwrites 2024 and earlier; 2025+ is kept from current).
CURRENT_KEEP_YEAR = 2025
EPS_ROW = "稀释后 每年/季度每股收益 元"
GROWTH_ROW = "每股利润增长率 x 100%"


def bootstrap_env():
    """Hydrate ONEDRIVE_* env from config.cfg; return proxy address or None."""
    proxy = None
    if not os.path.exists("./config.cfg"):
        return proxy
    c = configparser.ConfigParser()
    c.read(["config.cfg"])
    if "proxy_add" in c:
        try:
            login = os.getlogin()
        except Exception:  # noqa: BLE001
            login = ""
        if login != "cindy.rao":
            proxy = c["proxy_add"].get("proxy_add") or None
    if "onedrive" in c:
        od = c["onedrive"]
        for key in ("ONEDRIVE_CLIENT_ID", "TOKEN_ENC_KEY",
                    "ONEDRIVE_REFRESH_TOKEN", "ONEDRIVE_APP_ROOT"):
            val = od.get(key)
            if val and not os.environ.get(key):
                os.environ[key] = val
    os.environ.setdefault("ONEDRIVE_RT_READONLY", "1")
    return proxy


def code_prefix(name):
    """'600875.ss-Y-东方电气.pkl' -> '600875.ss-Y-' (matching key), or None."""
    if "-Y-" not in name or not name.endswith(".pkl"):
        return None
    return name.split("-Y-", 1)[0] + "-Y-"


def col_year(col):
    return int(str(col)[:4])


def merge_yearly(cur, sav):
    """Return merged DataFrame per the pre-2026 overwrite rule."""
    # --- index order: saved first, then current-only rows -----------------
    ordered_index = list(sav.index) + [i for i in cur.index if i not in sav.index]
    cur = cur.reindex(ordered_index)
    sav = sav.reindex(ordered_index)

    # --- columns: saved authoritative; add current-only columns -----------
    result = sav.copy()
    extra_cols = [c for c in cur.columns if c not in sav.columns]
    if extra_cols:
        result = pd.concat([result, cur[extra_cols]], axis=1)

    # Columns for the kept year and above always come from the current file
    # (Saved is authoritative only for older years).
    for c in cur.columns:
        if col_year(c) >= CURRENT_KEEP_YEAR:
            result[c] = cur[c]

    # --- sort columns descending by date ----------------------------------
    sorted_cols = pd.to_datetime(result.columns).sort_values(ascending=False)
    result = result[sorted_cols.strftime("%Y-%m-%d")]

    # --- recompute growth row ---------------------------------------------
    if EPS_ROW in result.index:
        result.loc[GROWTH_ROW] = pd.to_numeric(
            result.loc[EPS_ROW], errors="coerce").pct_change(-1, fill_method=None).round(2)

    return result


def describe_diff(name, cur, sav, merged):
    print("---- %s" % name)
    print("     cur cols : %s" % list(cur.columns))
    print("     sav cols : %s" % list(sav.columns))
    print("     new cols : %s" % list(merged.columns))
    added_rows = [i for i in merged.index if i not in cur.index]
    if added_rows:
        print("     +rows    : %s" % added_rows)
    # overlapping-column value changes vs current
    changed = []
    for c in merged.columns:
        if c in cur.columns:
            a = cur[c].reindex(merged.index)
            b = merged[c]
            neq = (a.fillna("∅").astype(str) != b.fillna("∅").astype(str))
            if neq.any():
                changed.append(c)
    if changed:
        print("     changed  : %s (overlapping cols with differing values)" % changed)
    print()


def main():
    apply = "--apply" in sys.argv
    proxy = bootstrap_env()
    od = OneDrivePersonal(proxies={"http": proxy, "https": proxy} if proxy else None)

    cur_children = od.list_children("history")
    cur_yearly = {}
    for it in cur_children:
        if "file" in it:
            p = code_prefix(it["name"])
            if p:
                cur_yearly[p] = it["name"]

    sav_children = od.list_children(SAVED_DIR)
    sav_yearly = {}
    for it in sav_children:
        if "file" in it:
            p = code_prefix(it["name"])
            if p:
                sav_yearly[p] = it["name"]

    matched = sorted(set(cur_yearly) & set(sav_yearly))
    skipped_sav = sorted(set(sav_yearly) - set(cur_yearly))

    print("Mode: %s\n" % ("APPLY (writing pkls + deleting folder)" if apply
                          else "DRY-RUN (no writes)"))
    print("Matched yearly files to merge: %d" % len(matched))
    if skipped_sav:
        print("Skipped Saved-only stocks (no current match): %s"
              % [sav_yearly[p] for p in skipped_sav])
    print()

    merged_results = {}
    for p in matched:
        cur_name = cur_yearly[p]
        sav_name = sav_yearly[p]
        cur = od.get_pickle("history/" + cur_name)
        sav = od.get_pickle(SAVED_DIR + "/" + sav_name)
        merged = merge_yearly(cur, sav)
        merged_results[cur_name] = merged
        describe_diff(cur_name, cur, sav, merged)

    if not apply:
        print("Dry-run complete. Re-run with --apply to write %d files and "
              "delete %s." % (len(merged_results), SAVED_DIR))
        return

    for cur_name, merged in merged_results.items():
        od.put_pickle("history/" + cur_name, merged)
        print("Wrote history/%s" % cur_name)
    print("\nDeleting folder %s ..." % SAVED_DIR)
    od.delete_path(SAVED_DIR)
    print("Deleted. Migration complete.")


if __name__ == "__main__":
    main()
