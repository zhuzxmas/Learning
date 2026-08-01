#!/usr/bin/env python3
"""Personal-OneDrive (delegated / refresh-token) access for the stock batch.

This mirrors the proven unattended-auth pattern used by
``a_cnmas_top/Family-tracker/automation/summarize.py`` (device-code bootstrap ->
encrypted ``rt.enc`` -> redeem for access token + rotated refresh token), but:

  * every network call is **proxy aware** so it works from behind the Ford
    corporate proxy during local testing, and
  * files are addressed by **root-relative path** under
    ``/me/drive/root:/App/StockBatchTracker/...`` (no 1drv.ms share links).

The refresh token is shared with the summarizer (same ``rt.enc``); to avoid
desyncing that shared token during local experiments, set the environment
variable ``ONEDRIVE_RT_READONLY=1`` (or pass ``rt_readonly=True``) and this
module will redeem for an access token but never rewrite ``rt.enc``.

Auth inputs (env vars, mirrors the summarizer):
  ONEDRIVE_CLIENT_ID       Entra app (client) id
  TOKEN_ENC_KEY            Fernet key used to encrypt/decrypt rt.enc
  ONEDRIVE_REFRESH_TOKEN   initial refresh token (first-run fallback)
Optional:
  ONEDRIVE_RT_READONLY     "1"/"true"/"yes" -> never rewrite rt.enc
  ONEDRIVE_APP_ROOT        override the root folder (default App/StockBatchTracker)
"""

import io
import os
import pickle
import sys
import time

import requests
from cryptography.fernet import Fernet

AUTHORITY = "https://login.microsoftonline.com/consumers"
TOKEN_URL = AUTHORITY + "/oauth2/v2.0/token"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = "offline_access Files.ReadWrite.All User.Read"

# Shared encrypted refresh token, committed in the Family-tracker automation
# folder and rotated by the summarizer workflow.
_HERE = os.path.dirname(os.path.abspath(__file__))
RT_ENC_PATH = os.path.join(
    _HERE, "a_cnmas_top", "Family-tracker", "automation", "rt.enc")

APP_ROOT = os.environ.get("ONEDRIVE_APP_ROOT", "Apps/StockBatchTracker").strip("/")


def _truthy(v):
    return str(v).strip().lower() in ("1", "true", "yes", "on")


class OneDrivePersonal:
    """Thin authenticated Graph client for the stock batch's OneDrive folder."""

    def __init__(self, proxies=None, rt_readonly=None):
        # ``proxies`` matches the dict the batch already builds:
        #   {"http": proxy_add, "https": proxy_add}   (values may be None)
        self.proxies = proxies or None
        if rt_readonly is None:
            rt_readonly = _truthy(os.environ.get("ONEDRIVE_RT_READONLY", ""))
        self.rt_readonly = rt_readonly

        self.client_id = os.environ.get("ONEDRIVE_CLIENT_ID", "").strip()
        enc_key = os.environ.get("TOKEN_ENC_KEY", "").strip()
        if not self.client_id or not enc_key:
            raise RuntimeError(
                "ONEDRIVE_CLIENT_ID and TOKEN_ENC_KEY are required "
                "(set them in config.cfg locally or as GitHub Secrets).")
        self._fernet = Fernet(enc_key.encode("utf-8"))
        self.access_token = None
        self._refresh_token = None   # latest rotating RT, kept in memory
        self._expiry = 0.0           # monotonic time when access_token goes stale
        self.authenticate()

    # ---- refresh-token handling ------------------------------------------
    def _load_refresh_token(self):
        # Prefer the rotating token from the most recent in-process refresh so a
        # mid-run re-auth doesn't replay an already-consumed (single-use) RT.
        if self._refresh_token:
            return self._refresh_token
        if os.path.exists(RT_ENC_PATH):
            try:
                with open(RT_ENC_PATH, "rb") as fh:
                    return self._fernet.decrypt(fh.read()).decode("utf-8")
            except Exception as e:  # noqa: BLE001
                print("WARN: could not decrypt rt.enc (%s); "
                      "falling back to ONEDRIVE_REFRESH_TOKEN." % e)
        rt = os.environ.get("ONEDRIVE_REFRESH_TOKEN", "").strip()
        if not rt:
            raise RuntimeError(
                "No rt.enc and no ONEDRIVE_REFRESH_TOKEN — cannot authenticate.")
        return rt

    def _save_refresh_token(self, refresh_token):
        if self.rt_readonly:
            print("ONEDRIVE_RT_READONLY set — not rewriting rt.enc "
                  "(shared token left untouched).")
            return
        with open(RT_ENC_PATH, "wb") as fh:
            fh.write(self._fernet.encrypt(refresh_token.encode("utf-8")))

    def authenticate(self):
        refresh_token = self._load_refresh_token()
        r = requests.post(TOKEN_URL, data={
            "grant_type": "refresh_token",
            "client_id": self.client_id,
            "refresh_token": refresh_token,
            "scope": SCOPES,
        }, proxies=self.proxies)
        if not r.ok:
            raise RuntimeError(
                "token refresh failed: %s %s" % (r.status_code, r.text))
        d = r.json()
        self.access_token = d["access_token"]
        # Refresh a few minutes before the real expiry to avoid mid-call 401s.
        expires_in = int(d.get("expires_in", 3600) or 3600)
        self._expiry = time.monotonic() + max(60, expires_in - 300)
        new_rt = d.get("refresh_token", refresh_token)
        self._refresh_token = new_rt or refresh_token   # keep rotating RT in memory
        if new_rt and new_rt != refresh_token:
            self._save_refresh_token(new_rt)
            if not self.rt_readonly:
                print("Rotated refresh token (rt.enc updated).")
        else:
            self._save_refresh_token(new_rt or refresh_token)
        print("Personal-OneDrive access token obtained.")
        return self.access_token

    def _ensure_fresh(self):
        """Re-authenticate if the current access token is near/after expiry."""
        if not self.access_token or time.monotonic() >= self._expiry:
            self.authenticate()

    # ---- Graph helpers (root-relative paths) -----------------------------
    def _headers(self, extra=None):
        h = {"Authorization": "Bearer " + self.access_token}
        if extra:
            h.update(extra)
        return h

    def _item_url(self, path, suffix=""):
        # path is relative to APP_ROOT, e.g. "kline/603259.SH.txt"
        full = "%s/%s" % (APP_ROOT, path.strip("/"))
        return "%s/me/drive/root:/%s:%s" % (GRAPH, full, suffix)

    def _request(self, method, url, extra_headers=None, **kw):
        """Send an authenticated Graph request, refreshing the token proactively
        and retrying once on a 401 (in case the token lapsed mid-run)."""
        self._ensure_fresh()
        r = requests.request(method, url, headers=self._headers(extra_headers),
                             proxies=self.proxies, **kw)
        if r.status_code == 401:
            # Token rejected despite our expiry estimate — force one re-auth+retry.
            self.authenticate()
            r = requests.request(method, url, headers=self._headers(extra_headers),
                                 proxies=self.proxies, **kw)
        return r

    def get_bytes(self, path):
        """Return file content as bytes, or None if it does not exist."""
        r = self._request("GET", self._item_url(path, "/content"))
        if r.status_code == 404:
            return None
        if not r.ok:
            raise RuntimeError(
                "download failed (%s): %s %s" % (path, r.status_code, r.text))
        return r.content

    def get_text(self, path, encoding="utf-8"):
        b = self.get_bytes(path)
        return None if b is None else b.decode(encoding, errors="replace")

    def put_bytes(self, path, data, content_type="application/octet-stream"):
        r = self._request("PUT", self._item_url(path, "/content"),
                          extra_headers={"Content-Type": content_type}, data=data)
        if not r.ok:
            raise RuntimeError(
                "upload failed (%s): %s %s" % (path, r.status_code, r.text))
        return r.json()

    def put_text(self, path, text, content_type="text/plain; charset=utf-8"):
        return self.put_bytes(path, text.encode("utf-8"), content_type)

    def upload_to_path(self, root_path, data, content_type="application/octet-stream"):
        """Upload bytes to a path relative to the OneDrive *root* (NOT APP_ROOT).

        Unlike put_bytes (which is scoped to APP_ROOT), this targets an arbitrary
        drive-root path such as "Pictures/life.live/Bing.WallPaper/foo.jpg".
        Missing parent folders are created automatically by Graph. Reuses the
        same token-refresh / proxy / 401-retry machinery as every other call.
        """
        url = "%s/me/drive/root:/%s:/content" % (GRAPH, root_path.strip("/"))
        r = self._request("PUT", url,
                          extra_headers={"Content-Type": content_type}, data=data)
        if not r.ok:
            raise RuntimeError(
                "upload failed (%s): %s %s" % (root_path, r.status_code, r.text))
        return r.json()

    def get_pickle(self, path):
        """Load a pickled object from OneDrive, or None if the file is absent."""
        b = self.get_bytes(path)
        if b is None:
            return None
        return pickle.loads(b)

    def put_pickle(self, path, obj):
        buf = io.BytesIO()
        pickle.dump(obj, buf)
        return self.put_bytes(path, buf.getvalue())

    def delete_path(self, path):
        """Delete a file or folder (recursively) at APP_ROOT/path.

        Returns True on success (or if already absent), raises on other errors.
        """
        r = self._request("DELETE", self._item_url(path))
        if r.status_code in (204, 404):
            return True
        raise RuntimeError(
            "delete failed (%s): %s %s" % (path, r.status_code, r.text))

    def list_children(self, subpath=""):
        """List children (names + ids) of APP_ROOT/subpath; [] if missing."""
        if subpath:
            url = self._item_url(subpath, "/children")
        else:
            url = "%s/me/drive/root:/%s:/children" % (GRAPH, APP_ROOT)
        url += "?$select=name,id,file,lastModifiedDateTime&$top=200"
        out = []
        while url:
            r = self._request("GET", url)
            if r.status_code == 404:
                return []
            if not r.ok:
                raise RuntimeError("list children failed (%s): %s %s"
                                   % (subpath, r.status_code, r.text))
            d = r.json()
            out.extend(d.get("value", []))
            url = d.get("@odata.nextLink")
        return out


def load_config_cfg_env():
    """Locally hydrate ONEDRIVE_* env vars + return proxy from config.cfg.

    Mirrors finance_batch_personal._bootstrap_local_env so the standalone smoke
    test below works the same way. Returns the proxy address (or None).
    """
    import configparser
    proxy_add = None
    if not os.path.exists("./config.cfg"):
        return proxy_add
    config = configparser.ConfigParser()
    config.read(["config.cfg"])
    if "proxy_add" in config:
        try:
            login = os.getlogin()
        except Exception:  # noqa: BLE001
            login = ""
        if login != "cindy.rao":
            proxy_add = config["proxy_add"].get("proxy_add") or None
    if "onedrive" in config:
        od = config["onedrive"]
        for key in ("ONEDRIVE_CLIENT_ID", "TOKEN_ENC_KEY",
                    "ONEDRIVE_REFRESH_TOKEN", "ONEDRIVE_APP_ROOT"):
            val = od.get(key)
            if val and not os.environ.get(key):
                os.environ[key] = val
    os.environ.setdefault("ONEDRIVE_RT_READONLY", "1")
    return proxy_add


if __name__ == "__main__":
    # Smoke test: authenticate and list the root folder.
    proxy_add = load_config_cfg_env()
    proxies = {"http": proxy_add, "https": proxy_add} if proxy_add else None
    od = OneDrivePersonal(proxies=proxies)
    print("Listing /%s ..." % APP_ROOT)
    for it in od.list_children():
        kind = "file" if "file" in it else "dir "
        print("  [%s] %s" % (kind, it.get("name")))
    sys.exit(0)
