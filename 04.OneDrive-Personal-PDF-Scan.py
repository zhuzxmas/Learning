#!/usr/bin/env python3
"""Scan Pictures/ZZ.Temp on personal OneDrive and rasterise new PDFs to PNG.

Runs from the OneDrive-Personal-PDF-Scan GitHub Action every 30 minutes (Beijing
07:00-24:00). For every PDF that appears anywhere under ``Pictures/ZZ.Temp``
(newly created OR moved in) and has not been processed yet, it downloads the
PDF, renders each page to a 300-dpi PNG, and uploads the PNGs back into the same
folder as the PDF.

DESIGN (see the planning discussion):
  * Uses its OWN independent refresh token (Secret ONEDRIVE_REFRESH_TOKEN_PDF),
    kept fresh by rotating it back into the Secret via the GitHub API each run.
    It therefore never touches the shared automation/rt.enc used by the other
    OneDrive workflows -> zero token conflict.
  * "Already processed" is tracked by driveItem id in a small state file on
    OneDrive itself: Apps/PDF2PNGTracker/state.json. No git commits involved.
  * FIRST RUN (no state) only SEEDS: it records every PDF currently present as
    processed WITHOUT converting them, so only PDFs that arrive afterwards get
    rasterised.
  * PNG uploads are not PDFs, so they never re-trigger processing -> no loop.

Required env vars (set by the workflow):
  ONEDRIVE_CLIENT_ID           Entra app (client) id
  ONEDRIVE_REFRESH_TOKEN_PDF   independent refresh token (rotated in place)
  GH_PAT_SECRETS               PAT with 'secrets: write' to update the Secret
  GITHUB_REPOSITORY            "owner/repo" (auto-set by Actions)
Optional:
  WATCH_FOLDER                 default "Pictures/ZZ.Temp"
  STATE_PATH                   default "Apps/PDF2PNGTracker/state.json"
  RENDER_DPI                   default "300"
  SECRET_NAME                  default "ONEDRIVE_REFRESH_TOKEN_PDF"
"""

import base64
import json
import os
import sys
import tempfile

import requests
from pdf2image import convert_from_path

try:  # pynacl is only needed to update the GitHub Secret.
    from nacl import encoding, public
    _HAVE_NACL = True
except Exception:  # noqa: BLE001
    _HAVE_NACL = False

AUTHORITY = "https://login.microsoftonline.com/consumers"
TOKEN_URL = AUTHORITY + "/oauth2/v2.0/token"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = "offline_access Files.ReadWrite.All User.Read"

WATCH_FOLDER = os.environ.get("WATCH_FOLDER", "Pictures/ZZ.Temp").strip("/")
STATE_PATH = os.environ.get("STATE_PATH", "Apps/PDF2PNGTracker/state.json").strip("/")
RENDER_DPI = int(os.environ.get("RENDER_DPI", "300") or "300")
SECRET_NAME = os.environ.get("SECRET_NAME", "ONEDRIVE_REFRESH_TOKEN_PDF")


def fail(msg):
    print("ERROR:", msg)
    sys.exit(1)


# --------------------------------------------------------------------------
# Auth: redeem the independent refresh token, then rotate it into the Secret.
# --------------------------------------------------------------------------
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


def update_github_secret(new_rt):
    """Write the rotated refresh token back into the repo Secret via the API."""
    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    pat = os.environ.get("GH_PAT_SECRETS", "").strip()
    if not repo or not pat:
        print("WARN: GITHUB_REPOSITORY / GH_PAT_SECRETS not set — cannot rotate "
              "the Secret; leaving it unchanged.")
        return
    if not _HAVE_NACL:
        print("WARN: pynacl not available — cannot encrypt the Secret; leaving "
              "it unchanged.")
        return
    api = "https://api.github.com"
    hdr = {
        "Authorization": "Bearer " + pat,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    # 1. Fetch the repo public key.
    kr = requests.get("%s/repos/%s/actions/secrets/public-key" % (api, repo),
                      headers=hdr)
    if not kr.ok:
        print("WARN: could not fetch repo public key (%s): %s"
              % (kr.status_code, kr.text))
        return
    kd = kr.json()
    key_id = kd["key_id"]
    pub = public.PublicKey(kd["key"].encode("utf-8"), encoding.Base64Encoder())
    sealed = public.SealedBox(pub).encrypt(new_rt.encode("utf-8"))
    enc_value = base64.b64encode(sealed).decode("utf-8")
    # 2. Upsert the secret.
    ur = requests.put(
        "%s/repos/%s/actions/secrets/%s" % (api, repo, SECRET_NAME),
        headers=hdr,
        json={"encrypted_value": enc_value, "key_id": key_id})
    if ur.status_code in (201, 204):
        print("Rotated refresh token (Secret %s updated)." % SECRET_NAME)
    else:
        print("WARN: failed to update Secret (%s): %s"
              % (ur.status_code, ur.text))


# --------------------------------------------------------------------------
# Graph helpers (personal /me/drive).
# --------------------------------------------------------------------------
class Graph:
    def __init__(self, access_token):
        self.h = {"Authorization": "Bearer " + access_token}

    def get_json(self, url):
        r = requests.get(url, headers=self.h)
        if r.status_code == 404:
            return None
        if not r.ok:
            fail("GET %s -> %s %s" % (url, r.status_code, r.text))
        return r.json()

    def folder_id(self, root_path):
        url = "%s/me/drive/root:/%s" % (GRAPH, root_path)
        d = self.get_json(url)
        if not d:
            fail("watch folder '%s' not found on OneDrive." % root_path)
        return d["id"]

    def list_pdfs_recursive(self, folder_id):
        """Return [{id, name, parent_path}] for every .pdf under folder_id."""
        out = []
        stack = [folder_id]
        while stack:
            fid = stack.pop()
            url = ("%s/me/drive/items/%s/children"
                   "?$select=id,name,file,folder,parentReference&$top=200"
                   % (GRAPH, fid))
            while url:
                d = self.get_json(url)
                if not d:
                    break
                for it in d.get("value", []):
                    if "folder" in it:
                        stack.append(it["id"])
                    elif "file" in it and it.get("name", "").lower().endswith(".pdf"):
                        # parentReference.path looks like "/drive/root:/Pictures/ZZ.Temp"
                        raw = (it.get("parentReference") or {}).get("path", "")
                        parent = raw.split("root:", 1)[-1].strip("/") if "root:" in raw else ""
                        out.append({"id": it["id"], "name": it["name"],
                                    "parent_path": parent})
                url = d.get("@odata.nextLink")
        return out

    def download(self, item_id):
        r = requests.get("%s/me/drive/items/%s/content" % (GRAPH, item_id),
                         headers=self.h)
        if not r.ok:
            fail("download %s -> %s %s" % (item_id, r.status_code, r.text))
        return r.content

    def upload_to_path(self, root_path, data, content_type):
        url = "%s/me/drive/root:/%s:/content" % (GRAPH, root_path.strip("/"))
        r = requests.put(url, headers={**self.h, "Content-Type": content_type},
                         data=data)
        if not r.ok:
            fail("upload %s -> %s %s" % (root_path, r.status_code, r.text))
        return r.json()

    def get_text(self, root_path):
        r = requests.get("%s/me/drive/root:/%s:/content" % (GRAPH, root_path),
                         headers=self.h)
        if r.status_code == 404:
            return None
        if not r.ok:
            fail("read %s -> %s %s" % (root_path, r.status_code, r.text))
        return r.content.decode("utf-8", errors="replace")

    def put_text(self, root_path, text):
        return self.upload_to_path(root_path, text.encode("utf-8"),
                                   "application/json")


# --------------------------------------------------------------------------
# PDF -> PNG.
# --------------------------------------------------------------------------
def pdf_to_pngs(pdf_bytes, filename, out_dir, dpi):
    name_no_ext = os.path.splitext(filename)[0]
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
        tf.write(pdf_bytes)
        pdf_path = tf.name
    try:
        pages = convert_from_path(pdf_path, dpi=dpi, fmt="png", thread_count=4)
    finally:
        try:
            os.remove(pdf_path)
        except OSError:
            pass
    saved = []
    for i, page in enumerate(pages):
        num = "%02d" % i
        img_path = os.path.join(out_dir, "%s_%s.png" % (name_no_ext, num))
        page.save(img_path, "PNG")
        saved.append(img_path)
    return saved


# --------------------------------------------------------------------------
def main():
    client_id = os.environ.get("ONEDRIVE_CLIENT_ID", "").strip()
    rt = os.environ.get("ONEDRIVE_REFRESH_TOKEN_PDF", "").strip()
    if not client_id or not rt:
        fail("ONEDRIVE_CLIENT_ID and ONEDRIVE_REFRESH_TOKEN_PDF are required.")

    access_token, new_rt = redeem(client_id, rt)
    if new_rt and new_rt != rt:
        update_github_secret(new_rt)
    g = Graph(access_token)

    folder_id = g.folder_id(WATCH_FOLDER)
    pdfs = g.list_pdfs_recursive(folder_id)
    present_ids = {p["id"] for p in pdfs}
    print("Found %d PDF(s) under %s." % (len(pdfs), WATCH_FOLDER))

    # Load state.
    raw = g.get_text(STATE_PATH)
    if raw is None:
        # FIRST RUN: seed only, do not convert anything.
        state = {"processed_ids": sorted(present_ids)}
        g.put_text(STATE_PATH, json.dumps(state, ensure_ascii=False, indent=2))
        print("First run: seeded %d existing PDF(s) as processed; converted "
              "none. Future PDFs will be rasterised." % len(present_ids))
        return

    try:
        processed = set(json.loads(raw).get("processed_ids", []))
    except Exception:  # noqa: BLE001
        processed = set()

    new_pdfs = [p for p in pdfs if p["id"] not in processed]
    print("%d new PDF(s) to process." % len(new_pdfs))

    done_ids = set()
    with tempfile.TemporaryDirectory() as tmp:
        for p in new_pdfs:
            print("Processing:", p["name"], "in", p["parent_path"])
            try:
                pdf_bytes = g.download(p["id"])
                imgs = pdf_to_pngs(pdf_bytes, p["name"], tmp, RENDER_DPI)
                for img in imgs:
                    with open(img, "rb") as fh:
                        data = fh.read()
                    dest = "%s/%s" % (p["parent_path"], os.path.basename(img))
                    g.upload_to_path(dest, data, "image/png")
                    print("  uploaded:", dest)
                    os.remove(img)
                done_ids.add(p["id"])
            except SystemExit:
                raise
            except Exception as e:  # noqa: BLE001
                # Don't mark as done so it retries next run.
                print("  FAILED %s: %s" % (p["name"], e))

    # New processed set = still-present ids that are either previously processed
    # or just finished. Pruned to current folder contents to stay small.
    new_processed = (processed | done_ids) & present_ids
    state = {"processed_ids": sorted(new_processed)}
    g.put_text(STATE_PATH, json.dumps(state, ensure_ascii=False, indent=2))
    print("Done. Converted %d PDF(s); state now tracks %d id(s)."
          % (len(done_ids), len(new_processed)))


if __name__ == "__main__":
    main()
