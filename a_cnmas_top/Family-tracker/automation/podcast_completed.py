#!/usr/bin/env python3

import datetime as dt
import html
import json
import os
import re
import sys
import time
from urllib.parse import urlparse

import requests
from cryptography.fernet import Fernet

import summarize

FILE_NAME = "podcast-history.json"
DEFAULT_FOLDER_PATH = "/Apps/PodcastTracker"
LOOKUP_URL = "https://itunes.apple.com/lookup"
WECOM_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send"
HISTORY_URL = "https://a.cnmas.top/?view=podcasts"
DEEPSEEK_MODEL_DEFAULT = "deepseek-v4-flash"
USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)


def fail(message):
    print("ERROR:", message)
    sys.exit(1)


def one_line(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def strip_html(value):
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return one_line(html.unescape(text))


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
        results = response.json().get("results") or []
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
            "description": strip_html(item.get("description")),
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
    text = response.text
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
            result.setdefault("description", strip_html(node.get("description")))
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
    result.setdefault("description", strip_html(tags.get("og:description") or tags.get("description")))
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
    if not metadata.get("title"):
        metadata["title"] = "Apple Podcasts 单集 " + episode["episode_id"]
    metadata.setdefault("showTitle", "")
    metadata.setdefault("artworkUrl", "")
    metadata.setdefault("description", "")
    metadata.setdefault("publishedAt", "")
    metadata.setdefault("durationSeconds", None)
    return metadata


def generate_introduction(metadata):
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        print("WARN: DEEPSEEK_API_KEY not set; skipping introduction.")
        return "", ""
    model = os.environ.get("DEEPSEEK_MODEL", "").strip() or DEEPSEEK_MODEL_DEFAULT
    description = str(metadata.get("description") or "")[:6000]
    prompt = (
        "请根据下面的播客单集信息，用简体中文写一段 80-140 字的介绍。"
        "说明这一集主要讲什么、有什么看点或适合谁听。"
        "只依据提供的信息，不要编造人名、数字、结论或节目中没有的内容。"
        "不要使用标题、列表或 Markdown，直接输出一段连贯的话。\n\n"
        "节目：%s\n单集：%s\n原始简介：%s"
    ) % (metadata.get("showTitle") or "未知节目", metadata.get("title") or "未知单集", description or "（无）")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是一位克制、准确的播客笔记助手。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
        "max_tokens": 320,
        "stream": False,
    }
    try:
        response = requests.post(
            summarize.DEEPSEEK_URL,
            headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=90,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return one_line(content), model
    except Exception as exc:
        print("WARN: introduction generation failed:", exc)
        return "", ""


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


def save_record(token, base, record):
    for attempt in range(5):
        data, etag = read_history(token, base)
        if find_record(data, record["episodeId"]):
            return None
        records = data.get("records") or []
        records.append(record)
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
            return response.json()
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
    if find_record(current, episode["episode_id"]):
        print("DUPLICATE apple:%s" % episode["episode_id"])
        return

    metadata = collect_metadata(episode)
    print("Metadata:", metadata.get("showTitle") or "-", "/", metadata.get("title") or "-")
    introduction, model = generate_introduction(metadata)
    record = {
        "id": "apple:" + episode["episode_id"],
        "source": "apple-podcasts",
        "episodeId": episode["episode_id"],
        "episodeUrl": episode["url"],
        "title": metadata.get("title") or ("Apple Podcasts 单集 " + episode["episode_id"]),
        "showTitle": metadata.get("showTitle") or "",
        "artworkUrl": metadata.get("artworkUrl") or "",
        "description": metadata.get("description") or "",
        "introduction": introduction,
        "introductionModel": model if introduction else "",
        "publishedAt": metadata.get("publishedAt") or "",
        "durationSeconds": metadata.get("durationSeconds"),
        "completedAt": completed_at,
        "recordedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "recordedBy": source,
    }
    saved = save_record(token, base, record)
    if saved is None:
        print("DUPLICATE apple:%s" % episode["episode_id"])
        return
    print("RECORDED apple:%s" % episode["episode_id"])
    notify_success(record)


if __name__ == "__main__":
    main()
