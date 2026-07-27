#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download all images referenced by blog_export.json from SharePoint via
Microsoft Graph, into test/blog_images/.

The SharePoint site + host are auto-derived from the pages' webUrl, so the
only thing you must supply is an ACCESS TOKEN:

  1. Open https://developer.microsoft.com/graph/graph-explorer
     Sign in with your WORK/SCHOOL account (the one that owns the site).
  2. Run once:  GET /sites/{host}:/sites/cmmas   (grants Sites.Read.All if asked)
  3. Click the "Access token" tab, copy the whole token.
  4. Save it into  test/blog_token.txt   (just the raw token, one line).
  5. Run:  python spending-tracker/tools/download_blog_images.py

Images that already exist in blog_images/ are skipped, so you can re-run if the
token expires (~1h) after refreshing it.

Console note: Windows console is cp1252 -> never print non-ASCII text.
"""
import json, os, sys, time
from urllib.parse import unquote, quote, urlparse
from urllib.request import Request, urlopen, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError

# Corporate proxy (override with env HTTPS_PROXY if set)
PROXY = os.environ.get("HTTPS_PROXY") or "http://internet.ford.com:83/"
_OPENER = build_opener(ProxyHandler({"http": PROXY, "https": PROXY})) if PROXY else build_opener()

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.dirname(ROOT)
SRC = os.path.join(BASE, "blog_export.json")
TOKEN_FILE = os.path.join(BASE, "blog_token.txt")
OUT = os.path.join(BASE, "blog_images")
GRAPH = "https://graph.microsoft.com/v1.0"


def die(msg):
    print("ERROR:", msg)
    sys.exit(1)


def read_token():
    if not os.path.exists(TOKEN_FILE):
        die("token file not found: " + TOKEN_FILE +
            "  (paste your Graph Explorer access token there)")
    with open(TOKEN_FILE, "r", encoding="utf-8") as f:
        tok = f.read().strip()
    if tok.lower().startswith("bearer "):
        tok = tok[7:].strip()
    if len(tok) < 100:
        die("token in blog_token.txt looks too short/invalid")
    return tok


def graph_get(url, token, binary=False):
    req = Request(url, headers={"Authorization": "Bearer " + token})
    resp = _OPENER.open(req, timeout=60)
    data = resp.read()
    return data if binary else json.loads(data.decode("utf-8"))


def collect_paths(pages):
    paths = []
    seen = set()
    for p in pages:
        cl = p.get("canvasLayout") or {}
        secs = list(cl.get("horizontalSections") or [])
        if cl.get("verticalSection"):
            secs.append(cl["verticalSection"])
        for s in secs:
            for col in s.get("columns") or []:
                for wp in col.get("webparts") or []:
                    if wp.get("@odata.type") != "#microsoft.graph.standardWebPart":
                        continue
                    srcs = (((wp.get("data") or {})
                             .get("serverProcessedContent") or {})
                            .get("imageSources") or [])
                    for src in srcs:
                        val = src.get("value")
                        if val and val not in seen:
                            seen.add(val)
                            paths.append(unquote(val))
    return paths


def derive_site(pages):
    """From a page webUrl -> (host, site_path). e.g.
    https://cnmas.sharepoint.com/sites/cmmas/SitePages/x.aspx
      -> ('cnmas.sharepoint.com', '/sites/cmmas')"""
    for p in pages:
        wu = p.get("webUrl") or ""
        u = urlparse(wu)
        if u.hostname and u.path:
            parts = [x for x in u.path.split("/") if x]
            # expect .../sites/<name>/...
            if "sites" in parts:
                i = parts.index("sites")
                if i + 1 < len(parts):
                    return u.hostname, "/" + "/".join(parts[i:i + 2])
    die("could not derive site from webUrl")


def drive_relpath(server_rel, site_path):
    """/sites/cmmas/Shared Documents/A/B.jpg  (+ site_path=/sites/cmmas)
       -> 'A/B.jpg'  (strip site path + the document-library segment)."""
    sp = site_path.rstrip("/")
    rel = server_rel
    if rel.startswith(sp + "/"):
        rel = rel[len(sp) + 1:]
    # drop first segment = library name ("Shared Documents" / localized)
    segs = rel.split("/", 1)
    return segs[1] if len(segs) == 2 else segs[0]


def share_url(abs_url):
    """Encode an absolute SharePoint file URL as a Graph /shares id."""
    import base64
    b = base64.b64encode(abs_url.encode("utf-8")).decode("ascii")
    sid = "u!" + b.rstrip("=").replace("/", "_").replace("+", "-")
    return "%s/shares/%s/driveItem/content" % (GRAPH, sid)


def fetch_image(server_rel, host, site_id, site_path, token):
    """Return image bytes, or None to skip. Strategies by source type:
       - .../Shared Documents/...  -> default drive path (fast)
       - absolute http(s) CDN      -> direct download (no auth)
       - other SharePoint libs     -> Graph /shares by absolute URL
       - _layouts system images    -> skip
    """
    low = server_rel.lower()
    if server_rel.startswith("http://") or server_rel.startswith("https://"):
        # Office stock-image CDN etc. -> plain GET via proxy, no auth
        req = Request(server_rel, headers={"User-Agent": "Mozilla/5.0"})
        return _OPENER.open(req, timeout=60).read()
    if "/_layouts/" in low:
        return None  # system template graphics, not real content
    if server_rel.startswith(site_path.rstrip("/") + "/shared documents/") or \
       "/shared documents/" in low:
        rel = drive_relpath(server_rel, site_path)
        url = "%s/sites/%s/drive/root:/%s:/content" % (GRAPH, site_id, quote(rel))
        return graph_get(url, token, binary=True)
    # SiteAssets or any other library -> shares API on absolute URL
    abs_url = "https://%s%s" % (host, quote(server_rel))
    return graph_get(share_url(abs_url), token, binary=True)


def main():
    if not os.path.exists(SRC):
        die("source not found: " + SRC)
    token = read_token()
    with open(SRC, "r", encoding="utf-8") as f:
        pages = json.load(f).get("value") or []

    host, site_path = derive_site(pages)
    print("site host:", host, " path:", site_path)

    # resolve siteId
    site_url = "%s/sites/%s:%s" % (GRAPH, host, site_path)
    try:
        site = graph_get(site_url, token)
    except HTTPError as e:
        die("resolving site failed HTTP %s (token expired/insufficient?)" % e.code)
    site_id = site.get("id")
    if not site_id:
        die("no site id returned")
    print("siteId resolved OK")

    paths = collect_paths(pages)
    print("image references to fetch:", len(paths))
    os.makedirs(OUT, exist_ok=True)

    ok = skip = fail = 0
    failed = []
    for i, sp in enumerate(paths, 1):
        name = os.path.basename(sp)
        dest = os.path.join(OUT, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            skip += 1
            continue
        try:
            data = fetch_image(sp, host, site_id, site_path, token)
            if data is None:
                skip += 1  # intentionally skipped (system template)
                continue
            with open(dest, "wb") as f:
                f.write(data)
            ok += 1
        except HTTPError as e:
            if e.code == 401:
                die("HTTP 401 at item %d -> token expired. Refresh blog_token.txt "
                    "and re-run (done ones are skipped)." % i)
            fail += 1
            failed.append((name, e.code))
        except URLError as e:
            fail += 1
            failed.append((name, str(e.reason)))
        if i % 20 == 0:
            print("  progress %d/%d (ok=%d skip=%d fail=%d)" % (i, len(paths), ok, skip, fail))
        time.sleep(0.05)

    print("DONE. downloaded:", ok, " skipped:", skip, " failed:", fail)
    if failed:
        print("failed items (first 10):")
        for n, c in failed[:10]:
            print("  ", ascii(n), c)


if __name__ == "__main__":
    main()
