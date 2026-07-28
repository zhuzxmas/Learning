#!/usr/bin/env python3
"""
Scheduled summarizer: reads the last N days of life-blog posts + AI-chat logs
from personal OneDrive, asks DeepSeek to write a combined Chinese Markdown
summary, and writes it back to the blog folder's  summaries/  subfolder.

Auth (personal OneDrive, no PAT):
  - The rolling refresh token lives encrypted in  automation/rt.enc  (committed
    to the repo). We decrypt it with TOKEN_ENC_KEY (a GitHub Secret), redeem it
    for an access token + a NEW refresh token, then re-encrypt and overwrite
    rt.enc. The workflow commits the updated rt.enc back with GITHUB_TOKEN.
  - First run (no rt.enc) falls back to the ONEDRIVE_REFRESH_TOKEN Secret.

Required environment variables (from GitHub Secrets):
  ONEDRIVE_CLIENT_ID       Entra app (client) id
  TOKEN_ENC_KEY            Fernet key used to encrypt rt.enc
  ONEDRIVE_REFRESH_TOKEN   initial refresh token (first-run fallback)
  DEEPSEEK_API_KEY         DeepSeek API key
Optional:
  SUMMARY_DAYS             look-back window in days (default 14; also used for
                           the calendar look-back)
  CAL_NAME                 name of the calendar to read (default "Celine-Nathan";
                           empty string disables the calendar section)
  DEEPSEEK_MODEL           default "deepseek-v4-pro"
"""

import base64
import datetime as dt
import json
import os
import sys
import requests
from cryptography.fernet import Fernet

# ---- constants (public; mirror the SPA's config) --------------------------
AUTHORITY = "https://login.microsoftonline.com/consumers"
TOKEN_URL = AUTHORITY + "/oauth2/v2.0/token"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = "offline_access Files.ReadWrite.All User.Read Calendars.Read"

# The two OneDrive shared folders (same links the SPA uses).
BLOG_FOLDER_SHARE_URL = "https://1drv.ms/f/c/7f804b34b24d36bb/IgD_C9X6ML7pSIzB8ZAu2f_4AcwVLgqme1RgJDphTWTghrM"
CHAT_FOLDER_SHARE_URL = "https://1drv.ms/f/c/7f804b34b24d36bb/IgB5autcGzJOSKCznhJ1X0n3AVgMO_Xx2FjWRhpgk4vP1ag?email=celine_mas%40outlook.com&e=Lsf6a0"

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

HERE = os.path.dirname(os.path.abspath(__file__))
RT_ENC_PATH = os.path.join(HERE, "rt.enc")

SUMMARY_DAYS = int(os.environ.get("SUMMARY_DAYS", "14"))
CAL_NAME = os.environ.get("CAL_NAME", "Celine-Nathan").strip()
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")

SYSTEM_PROMPT = (
    "你是一位贴心的生活记录助手。以下是我最近 {days} 天的生活博客正文、AI 对话记录，"
    "以及同一时期日历里已经发生的日程记录。"
    "请用中文输出一份 Markdown 摘要，包含：\n"
    "1. 本期概览（4-5 句，覆盖本期涉及的主要主题）\n"
    "2. 本期要点：把博客里发生的事、心情、值得记住的瞬间，AI 对话里我关心的问题、"
    "结论、建议，以及日历里记录的活动与安排，全部融合在一起，按时间/主题梳理成一条连贯的脉络，"
    "串成一个整体（不要按博客/对话/日历分栏）\n"
    "3. 待办 / 后续：从中抽取尚未完成或需要跟进的事项\n"
    "4. 一句话总结与鼓励\n"
    "不要编造未提供的信息；正文可能含 Markdown 图片语法，忽略图片。"
)


def fail(msg, code=1):
    print("ERROR:", msg)
    sys.exit(code)


# ---- auth -----------------------------------------------------------------
def load_refresh_token(fernet):
    if os.path.exists(RT_ENC_PATH):
        try:
            with open(RT_ENC_PATH, "rb") as fh:
                return fernet.decrypt(fh.read()).decode("utf-8")
        except Exception as e:
            print("WARN: could not decrypt rt.enc (%s); falling back to secret." % e)
    rt = os.environ.get("ONEDRIVE_REFRESH_TOKEN", "").strip()
    if not rt:
        fail("No rt.enc and no ONEDRIVE_REFRESH_TOKEN secret — cannot authenticate.")
    return rt


def save_refresh_token(fernet, refresh_token):
    with open(RT_ENC_PATH, "wb") as fh:
        fh.write(fernet.encrypt(refresh_token.encode("utf-8")))


def redeem(client_id, refresh_token):
    r = requests.post(TOKEN_URL, data={
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": refresh_token,
        "scope": SCOPES,
    })
    if not r.ok:
        fail("token refresh failed: %s %s" % (r.status_code, r.text))
    d = r.json()
    return d["access_token"], d.get("refresh_token", refresh_token)


# ---- Graph helpers --------------------------------------------------------
def encode_share_url(u):
    b64 = base64.b64encode(u.encode("utf-8")).decode("ascii")
    return "u!" + b64.rstrip("=").replace("/", "_").replace("+", "-")


def resolve_folder(token, share_url):
    sid = encode_share_url(share_url)
    r = requests.get(
        "%s/shares/%s/driveItem?$select=id,parentReference" % (GRAPH, sid),
        headers={"Authorization": "Bearer " + token},
    )
    if not r.ok:
        fail("cannot access shared folder: %s %s" % (r.status_code, r.text))
    item = r.json()
    drive_id = item["parentReference"]["driveId"]
    return "%s/drives/%s/items/%s" % (GRAPH, drive_id, item["id"])


def list_children(token, drive_base, subpath):
    """List children of drive_base/subpath, following pagination."""
    url = "%s:/%s:/children?$select=name,lastModifiedDateTime,file&$top=200" % (
        drive_base, subpath)
    out = []
    headers = {"Authorization": "Bearer " + token}
    while url:
        r = requests.get(url, headers=headers)
        if r.status_code == 404:
            return []  # subfolder doesn't exist yet
        if not r.ok:
            fail("list children failed (%s): %s %s" % (subpath, r.status_code, r.text))
        d = r.json()
        out.extend(d.get("value", []))
        url = d.get("@odata.nextLink")
    return out


def get_text(token, drive_base, path):
    r = requests.get("%s:/%s:/content" % (drive_base, path),
                     headers={"Authorization": "Bearer " + token})
    if r.status_code == 404:
        return None
    if not r.ok:
        fail("download failed (%s): %s" % (path, r.status_code))
    return r.text


def put_text(token, drive_base, path, text):
    r = requests.put(
        "%s:/%s:/content" % (drive_base, path),
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "text/markdown; charset=utf-8"},
        data=text.encode("utf-8"),
    )
    if not r.ok:
        fail("upload failed (%s): %s %s" % (path, r.status_code, r.text))


# ---- collect recent content ----------------------------------------------
def recent(items, cutoff_iso):
    keep = []
    for it in items:
        if "file" not in it:
            continue
        lm = it.get("lastModifiedDateTime", "")
        if lm >= cutoff_iso:
            keep.append(it)
    return keep


def load_index_map(token, drive_base, index_file, id_key, fields):
    """Read an index json ({posts|convs:[...]}) into {id: {field:...}}."""
    raw = get_text(token, drive_base, index_file)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    arr = data.get("posts") or data.get("convs") or []
    m = {}
    for e in arr:
        if isinstance(e, dict) and e.get(id_key):
            m[str(e[id_key])] = {f: e.get(f) for f in fields}
    return m


def collect_blog(token, days_cutoff):
    base = resolve_folder(token, BLOG_FOLDER_SHARE_URL)
    idx = load_index_map(token, base, "blog-index.json", "id", ["title", "date"])
    files = recent(list_children(token, base, "posts"), days_cutoff)
    files.sort(key=lambda f: f.get("lastModifiedDateTime", ""))
    parts = []
    for f in files:
        name = f["name"]
        pid = name[:-3] if name.endswith(".md") else name
        meta = idx.get(pid, {})
        title = meta.get("title") or pid
        date = meta.get("date") or f.get("lastModifiedDateTime", "")[:10]
        body = get_text(token, base, "posts/" + name) or ""
        parts.append("### [博客] %s（%s）\n%s" % (title, date, body.strip()))
    return base, parts


def collect_chats(token, days_cutoff):
    base = resolve_folder(token, CHAT_FOLDER_SHARE_URL)
    idx = load_index_map(token, base, "chat-index.json", "id", ["title", "updated"])
    files = recent(list_children(token, base, "chats"), days_cutoff)
    files.sort(key=lambda f: f.get("lastModifiedDateTime", ""))
    parts = []
    for f in files:
        name = f["name"]
        cid = name[:-5] if name.endswith(".json") else name
        title = (idx.get(cid, {}) or {}).get("title") or cid
        raw = get_text(token, base, "chats/" + name) or ""
        try:
            conv = json.loads(raw)
            msgs = conv.get("messages", [])
        except Exception:
            msgs = []
        lines = []
        for m in msgs:
            role = "我" if m.get("role") == "user" else "AI"
            content = (m.get("content") or "").strip()
            if content:
                lines.append("%s：%s" % (role, content))
        if lines:
            parts.append("### [对话] %s\n%s" % (title, "\n".join(lines)))
    return parts


# ---- collect upcoming calendar events -------------------------------------
_WEEKDAY_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _fmt_local(iso):
    """Parse an Outlook local dateTime like '2026-08-02T14:00:00.0000000'."""
    s = (iso or "").split(".")[0].replace("Z", "")
    try:
        return dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%S")
    except Exception:
        try:
            return dt.datetime.strptime(s[:10], "%Y-%m-%d")
        except Exception:
            return None


def _fmt_event(ev):
    start = ev.get("start", {}) or {}
    end = ev.get("end", {}) or {}
    sd = _fmt_local(start.get("dateTime"))
    ed = _fmt_local(end.get("dateTime"))
    subject = (ev.get("subject") or "(无标题)").strip()
    loc = ((ev.get("location") or {}).get("displayName") or "").strip()
    note = (ev.get("bodyPreview") or "").strip().replace("\r", " ").replace("\n", " ")
    if len(note) > 120:
        note = note[:120] + "…"
    if sd:
        day = "%02d-%02d %s" % (sd.month, sd.day, _WEEKDAY_CN[sd.weekday()])
    else:
        day = "?"
    if ev.get("isAllDay"):
        when = "%s 全天" % day
    elif sd and ed:
        when = "%s %02d:%02d–%02d:%02d" % (day, sd.hour, sd.minute, ed.hour, ed.minute)
    elif sd:
        when = "%s %02d:%02d" % (day, sd.hour, sd.minute)
    else:
        when = day
    line = "- %s %s" % (when, subject)
    if loc:
        line += " @%s" % loc
    if note:
        line += "（%s）" % note
    return (start.get("dateTime") or "", line)


def collect_calendar(token, cutoff_iso):
    """Collect the last N days of events from the CAL_NAME calendar only."""
    if not CAL_NAME:
        return []
    now_iso = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    headers = {
        "Authorization": "Bearer " + token,
        # Ask Graph to return event local times in Beijing time.
        "Prefer": 'outlook.timezone="China Standard Time"',
    }

    # 1. Find the target calendar by name (case-insensitive exact match).
    cals = []
    url = "%s/me/calendars?$select=id,name&$top=100" % GRAPH
    while url:
        r = requests.get(url, headers={"Authorization": "Bearer " + token})
        if not r.ok:
            print("WARN: cannot list calendars: %s %s" % (r.status_code, r.text[:300]))
            return []
        d = r.json()
        cals.extend(d.get("value", []))
        url = d.get("@odata.nextLink")

    target = None
    want = CAL_NAME.lower()
    for cal in cals:
        if (cal.get("name") or "").strip().lower() == want:
            target = cal
            break
    if not target:
        names = ", ".join((c.get("name") or "?") for c in cals)
        print("WARN: calendar '%s' not found. Available: %s" % (CAL_NAME, names))
        return []

    cid = target["id"]
    cname = target.get("name") or CAL_NAME

    # 2. Fetch the past-window events (cutoff .. now) for that calendar.
    events = []
    url = ("%s/me/calendars/%s/calendarView"
           "?startDateTime=%s&endDateTime=%s"
           "&$select=subject,start,end,location,isAllDay,bodyPreview"
           "&$orderby=start/dateTime&$top=100" % (GRAPH, cid, cutoff_iso, now_iso))
    while url:
        r = requests.get(url, headers=headers)
        if r.status_code in (403, 404):
            break
        if not r.ok:
            print("WARN: calendarView failed (%s): %s %s"
                  % (cname, r.status_code, r.text[:200]))
            break
        d = r.json()
        events.extend(d.get("value", []))
        url = d.get("@odata.nextLink")

    print("Found %d calendar events in '%s' (last %d days)."
          % (len(events), cname, SUMMARY_DAYS))
    if not events:
        return []
    rows = sorted((_fmt_event(e) for e in events), key=lambda t: t[0])
    return ["### [日历] %s\n%s" % (cname, "\n".join(r[1] for r in rows))]


# ---- DeepSeek -------------------------------------------------------------
def summarize(corpus):
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not key:
        fail("DEEPSEEK_API_KEY secret is missing.")
    payload = {
        "model": DEEPSEEK_MODEL,
        "stream": False,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT.format(days=SUMMARY_DAYS)},
            {"role": "user", "content": corpus},
        ],
    }
    # Log exactly what we send to DeepSeek (only when LOG_PROMPT is enabled).
    # The corpus contains your blog/chat text, so this is OFF by default; set
    # the LOG_PROMPT env/secret to 1/true/yes to reveal it in the Action logs.
    if os.environ.get("LOG_PROMPT", "").strip().lower() in ("1", "true", "yes"):
        print("\n" + "=" * 70)
        print("SENDING TO DEEPSEEK (model=%s)" % DEEPSEEK_MODEL)
        print("-" * 70)
        print("[system]\n" + payload["messages"][0]["content"])
        print("-" * 70)
        print("[user] (%d chars)\n%s" % (len(corpus), corpus))
        print("=" * 70 + "\n")
    else:
        print("Sending %d chars to DeepSeek (set LOG_PROMPT=1 to log full prompt)."
              % len(corpus))
    r = requests.post(DEEPSEEK_URL, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
    }, data=json.dumps(payload), timeout=300)
    if not r.ok:
        fail("DeepSeek error: %s %s" % (r.status_code, r.text[:500]))
    d = r.json()
    return d["choices"][0]["message"]["content"]


# ---- main -----------------------------------------------------------------
def main():
    client_id = os.environ.get("ONEDRIVE_CLIENT_ID", "").strip()
    enc_key = os.environ.get("TOKEN_ENC_KEY", "").strip()
    if not client_id or not enc_key:
        fail("ONEDRIVE_CLIENT_ID and TOKEN_ENC_KEY secrets are required.")
    fernet = Fernet(enc_key.encode("utf-8"))

    # Authenticate + rotate the refresh token.
    refresh_token = load_refresh_token(fernet)
    access_token, new_rt = redeem(client_id, refresh_token)
    if new_rt and new_rt != refresh_token:
        save_refresh_token(fernet, new_rt)
        print("Rotated refresh token (rt.enc updated).")
    else:
        # Ensure rt.enc exists even on the very first (secret-based) run.
        save_refresh_token(fernet, new_rt or refresh_token)

    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=SUMMARY_DAYS)) \
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    print("Collecting content modified since", cutoff)

    blog_base, blog_parts = collect_blog(access_token, cutoff)
    chat_parts = collect_chats(access_token, cutoff)
    cal_parts = collect_calendar(access_token, cutoff)
    print("Found %d recent blog posts, %d recent chats, %d calendar blocks." %
          (len(blog_parts), len(chat_parts), len(cal_parts)))

    if not blog_parts and not chat_parts and not cal_parts:
        print("No activity in the window. Nothing to summarize; exiting.")
        return

    corpus = "\n\n".join(blog_parts + chat_parts + cal_parts)
    # Safety cap so a huge window can't blow up the request.
    max_chars = 120000
    if len(corpus) > max_chars:
        corpus = corpus[:max_chars] + "\n\n（内容过长已截断）"

    print("Calling DeepSeek (%s)..." % DEEPSEEK_MODEL)
    summary = summarize(corpus)

    today = dt.date.today().strftime("%Y-%m-%d")
    header = "# 生活与对话摘要 · 最近 %d 天\n\n_生成于 %s（UTC）_\n\n" % (
        SUMMARY_DAYS, dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M"))
    out_path = "summaries/summary-%s.md" % today
    put_text(access_token, blog_base, out_path, header + summary)
    print("Wrote summary to blog folder:", out_path)


if __name__ == "__main__":
    main()
