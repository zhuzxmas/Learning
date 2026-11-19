#!/usr/bin/env python3

import datetime as dt
import html
import json
import os
import re
import sys
import time
from html.parser import HTMLParser
from urllib.parse import urlparse

import requests
from cryptography.fernet import Fernet

import summarize

FILE_NAME = "podcast-history.json"
DEFAULT_FOLDER_PATH = "/Apps/PodcastTracker"
LOOKUP_URL = "https://itunes.apple.com/lookup"
WECOM_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send"
HISTORY_URL = "https://a.cnmas.top/?view=podcasts"
USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)


def fail(message):
    print("ERROR:", message)
    sys.exit(1)


def one_line(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


class DescriptionParser(HTMLParser):
    BLOCK_TAGS = {"article", "blockquote", "div", "h1", "h2", "h3", "h4", "li", "p", "section"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, _attrs):
        if tag.lower() in self.BLOCK_TAGS or tag.lower() == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag.lower() in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def description_text(value):
    parser = DescriptionParser()
    parser.feed(str(value or ""))
    text = html.unescape("".join(parser.parts)).replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def repair_mojibake(value):
    if not isinstance(value, str) or not value:
        return value
    try:
        repaired = value.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    original_cjk = len(re.findall(r"[\u3400-\u9fff]", value))
    repaired_cjk = len(re.findall(r"[\u3400-\u9fff]", repaired))
    return repaired if repaired_cjk > original_cjk else value


def parse_episode_url(value):
    try:
        parsed = urlparse(str(value or ""))
    except ValueError:
        return None
    if parsed.scheme != "https" or parsed.netloc.lower() != "podcasts.apple.com":
        return None
    match = re.search(r"(?:^|&)i=(\d{1,20})(?:&|$)", parsed.query)
    if not match:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    country = parts[0].lower() if parts and re.fullmatch(r"[a-z]{2}", parts[0]) else ""
    return {"url": value, "episode_id": match.group(1), "country": country}


def normalize_time(value):
    if not value:
        return ""
    raw = str(value).strip()
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return raw
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_duration(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    match = re.fullmatch(
        r"P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?",
        str(value).strip(),
        re.I,
    )
    if not match:
        return None
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def first_image(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get("url") or value.get("contentUrl") or ""
    if isinstance(value, list):
        for item in value:
            found = first_image(item)
            if found:
                return found
    return ""


def walk_json(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def meta_tags(text):
    tags = {}
    for tag in re.findall(r"<meta\b[^>]*>", text, re.I):
        attrs = {}
        for name, single, double in re.findall(
            r"([a-zA-Z:_-]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')", tag
        ):
            attrs[name.lower()] = html.unescape(single or double)
        key = attrs.get("property") or attrs.get("name")
        if key and attrs.get("content"):
            tags[key.lower()] = attrs["content"]
    return tags


def lookup_itunes(episode_id, country):
    params = {
        "id": episode_id,
        "entity": "podcastEpisode",
        "media": "podcast",
        "country": country or "us",
    }
    try:
        response = requests.get(LOOKUP_URL, params=params, timeout=25)
        response.raise_for_status()
        results = json.loads(response.content.decode("utf-8-sig")).get("results") or []
    except Exception as exc:
        print("WARN: iTunes lookup failed:", exc)
        return {}
    for item in results:
        if str(item.get("trackId") or "") != str(episode_id):
            continue
        return {
            "title": one_line(item.get("trackName")),
            "showTitle": one_line(item.get("collectionName")),
            "artworkUrl": item.get("artworkUrl600") or item.get("artworkUrl160") or "",
            "description": description_text(item.get("description")),
            "publishedAt": normalize_time(item.get("releaseDate")),
            "durationSeconds": (
                int(item["trackTimeMillis"] // 1000)
                if isinstance(item.get("trackTimeMillis"), (int, float))
                else None
            ),
        }
    return {}


def scrape_episode_page(url):
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
            timeout=25,
        )
        response.raise_for_status()
    except Exception as exc:
        print("WARN: Apple episode page fetch failed:", exc)
        return {}
    text = response.content.decode("utf-8-sig", errors="replace")
    result = {}
    for block in re.findall(
        r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        text,
        re.I | re.S,
    ):
        try:
            data = json.loads(html.unescape(block.strip()))
        except Exception:
            continue
        for node in walk_json(data):
            types = node.get("@type")
            if isinstance(types, str):
                types = [types]
            if not any("PodcastEpisode" in str(item) for item in (types or [])):
                continue
            series = node.get("partOfSeries") if isinstance(node.get("partOfSeries"), dict) else {}
            result.setdefault("title", one_line(node.get("name") or node.get("headline")))
            result.setdefault("showTitle", one_line(series.get("name")))
            result.setdefault("description", description_text(node.get("description")))
            result.setdefault("publishedAt", normalize_time(node.get("datePublished")))
            result.setdefault(
                "durationSeconds",
                parse_duration(node.get("timeRequired") or node.get("duration")),
            )
            result.setdefault(
                "artworkUrl",
                first_image(node.get("image") or node.get("thumbnailUrl")),
            )
            break
    tags = meta_tags(text)
    result.setdefault("title", one_line(tags.get("og:title")))
    result.setdefault("description", description_text(tags.get("og:description") or tags.get("description")))
    result.setdefault("artworkUrl", tags.get("og:image") or "")
    if not result.get("title"):
        match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
        if match:
            result["title"] = one_line(html.unescape(match.group(1)))
    return {key: value for key, value in result.items() if value}


def collect_metadata(episode):
    metadata = lookup_itunes(episode["episode_id"], episode["country"])
    page = scrape_episode_page(episode["url"])
    for key, value in page.items():
        if not metadata.get(key):
            metadata[key] = value
    descriptions = [metadata.get("description") or "", page.get("description") or ""]
    metadata["description"] = max(descriptions, key=len)
    if not metadata.get("title"):
        metadata["title"] = "Apple Podcasts 单集 " + episode["episode_id"]
    metadata.setdefault("showTitle", "")
    metadata.setdefault("artworkUrl", "")
    metadata.setdefault("description", "")
    metadata.setdefault("publishedAt", "")
    metadata.setdefault("durationSeconds", None)
    for key in ("title", "showTitle", "description"):
        metadata[key] = repair_mojibake(metadata.get(key) or "")
    return metadata


def read_history(token, base):
    response = requests.get(
        "%s:/%s:/content" % (base, FILE_NAME),
        headers={"Authorization": "Bearer " + token},
    )
    if response.status_code == 404:
        return {"version": 1, "records": []}, None
    if not response.ok:
        fail("cannot read %s: %s %s" % (FILE_NAME, response.status_code, response.text[:300]))
    try:
        data = json.loads(response.content.decode("utf-8-sig"))
    except Exception as exc:
        fail("invalid %s: %s" % (FILE_NAME, exc))
    if not isinstance(data, dict) or not isinstance(data.get("records"), list):
        fail("%s must be an object with a records array" % FILE_NAME)
    return data, response.headers.get("ETag")


def find_record(data, episode_id):
    wanted = "apple:" + str(episode_id)
    for record in data.get("records") or []:
        if isinstance(record, dict) and record.get("id") == wanted:
            return record
    return None


def refresh_descriptions(data, target_episode_id=None):
    updates = {}
    for record in data.get("records") or []:
        if not isinstance(record, dict) or record.get("source") != "apple-podcasts":
            continue
        episode = parse_episode_url(record.get("episodeUrl"))
        if not episode or episode["episode_id"] == str(target_episode_id or ""):
            continue
        try:
            description = collect_metadata(episode).get("description") or ""
        except Exception as exc:
            print("WARN: cannot refresh apple:%s description: %s" % (episode["episode_id"], exc))
            continue
        if description:
            updates[episode["episode_id"]] = description
    return updates


def save_record(token, base, record, description_updates=None):
    description_updates = description_updates or {}
    for attempt in range(5):
        data, etag = read_history(token, base)
        records = []
        found = False
        changed = False
        for existing in data.get("records") or []:
            if not isinstance(existing, dict):
                continue
            existing = dict(existing)
            existing.pop("introduction", None)
            existing.pop("introductionModel", None)
            episode_id = str(existing.get("episodeId") or "")
            if episode_id == record["episodeId"]:
                found = True
                for key in ("title", "showTitle", "artworkUrl", "description", "publishedAt", "durationSeconds"):
                    value = record.get(key)
                    if value not in (None, "") and existing.get(key) != value:
                        existing[key] = value
                        changed = True
            elif description_updates.get(episode_id) and existing.get("description") != description_updates[episode_id]:
                existing["description"] = description_updates[episode_id]
                changed = True
            records.append(existing)
        if not found:
            records.append(record)
            changed = True
        if not changed:
            return {"created": False, "changed": False}
        records.sort(key=lambda item: str(item.get("completedAt") or ""), reverse=True)
        data["version"] = 1
        data["records"] = records
        headers = {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json; charset=utf-8",
        }
        if etag:
            headers["If-Match"] = etag
        else:
            headers["If-None-Match"] = "*"
        body = "\ufeff" + json.dumps(data, ensure_ascii=False, indent=2)
        response = requests.put(
            "%s:/%s:/content" % (base, FILE_NAME),
            headers=headers,
            data=body.encode("utf-8"),
        )
        if response.ok:
            return {"created": not found, "changed": True, "item": response.json()}
        if response.status_code in (409, 412):
            time.sleep(0.8 * (attempt + 1))
            continue
        if response.status_code == 404:
            fail("OneDrive folder is missing; create " + DEFAULT_FOLDER_PATH + " first.")
        fail("cannot write %s: %s %s" % (FILE_NAME, response.status_code, response.text[:300]))
    fail("cannot write %s: too many concurrent conflicts" % FILE_NAME)


def notify_success(record):
    key = os.environ.get("QY_WECHAT_API_KEY", "").strip()
    if not key:
        print("WARN: QY_WECHAT_API_KEY not set; skipping WeCom notification.")
        return
    completed = record.get("completedAt") or ""
    try:
        parsed = dt.datetime.fromisoformat(completed.replace("Z", "+00:00"))
        completed_text = parsed.astimezone(summarize.BEIJING).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        completed_text = completed
    content = (
        "### Podcast 已记录\n\n"
        "**节目：** %s\n"
        "**单集：** %s\n"
        "**完成时间：** %s\n\n"
        "[查看 Podcast History](%s)"
    ) % (one_line(record.get("showTitle")) or "未知节目",
         one_line(record.get("title")) or "未知单集",
         completed_text, HISTORY_URL)
    try:
        response = requests.post(
            WECOM_URL,
            params={"key": key},
            json={"msgtype": "markdown", "markdown": {"content": content}},
            timeout=20,
        )
        result = response.json()
        if not response.ok or result.get("errcode") != 0:
            print("WARN: WeCom notification failed:", response.status_code, result)
    except Exception as exc:
        print("WARN: WeCom notification failed:", exc)


def authenticate():
    client_id = os.environ.get("ONEDRIVE_CLIENT_ID", "").strip()
    enc_key = os.environ.get("TOKEN_ENC_KEY", "").strip()
    if not client_id or not enc_key:
        fail("ONEDRIVE_CLIENT_ID and TOKEN_ENC_KEY secrets are required.")
    fernet = Fernet(enc_key.encode("utf-8"))
    refresh_token = summarize.load_refresh_token(fernet)
    access_token, new_token = summarize.redeem(client_id, refresh_token)
    if new_token and new_token != refresh_token:
        summarize.save_refresh_token(fernet, new_token)
        print("Rotated refresh token (rt.enc updated).")
    else:
        summarize.save_refresh_token(fernet, new_token or refresh_token)
    return access_token


def resolve_base(token):
    share_url = os.environ.get("PODCAST_FOLDER_SHARE_URL", "").strip()
    if share_url:
        return summarize.resolve_folder(token, share_url)
    return "%s/me/drive/root:%s" % (summarize.GRAPH, DEFAULT_FOLDER_PATH)


def main():
    episode_url = os.environ.get("EPISODE_URL", "").strip()
    episode = parse_episode_url(episode_url)
    if not episode:
        fail("EPISODE_URL must be an https://podcasts.apple.com episode URL with ?i=<id>.")
    if os.environ.get("EPISODE_ID", "").strip():
        if os.environ["EPISODE_ID"].strip() != episode["episode_id"]:
            fail("EPISODE_ID does not match the URL's i parameter.")
    completed_at = normalize_time(os.environ.get("COMPLETED_AT")) or normalize_time(
        dt.datetime.now(dt.timezone.utc).isoformat()
    )
    source = one_line(os.environ.get("SOURCE")) or "github-action"

    token = authenticate()
    base = resolve_base(token)
    current, _ = read_history(token, base)

    metadata = collect_metadata(episode)
    print("Metadata:", metadata.get("showTitle") or "-", "/", metadata.get("title") or "-")
    record = {
        "id": "apple:" + episode["episode_id"],
        "source": "apple-podcasts",
        "episodeId": episode["episode_id"],
        "episodeUrl": episode["url"],
        "title": metadata.get("title") or ("Apple Podcasts 单集 " + episode["episode_id"]),
        "showTitle": metadata.get("showTitle") or "",
        "artworkUrl": metadata.get("artworkUrl") or "",
        "description": metadata.get("description") or "",
        "publishedAt": metadata.get("publishedAt") or "",
        "durationSeconds": metadata.get("durationSeconds"),
        "completedAt": completed_at,
        "recordedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "recordedBy": source,
    }
    description_updates = refresh_descriptions(current, episode["episode_id"])
    saved = save_record(token, base, record, description_updates)
    if not saved["created"]:
        if saved["changed"]:
            print("UPDATED descriptions for %s saved Podcast records" % (len(description_updates) + 1))
        print("DUPLICATE apple:%s" % episode["episode_id"])
        return
    print("RECORDED apple:%s" % episode["episode_id"])
    notify_success(record)


if __name__ == "__main__":
    main()
