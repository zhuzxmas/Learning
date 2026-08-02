#!/usr/bin/env python3
"""
One-time bootstrap for the ZZ.Temp PDF->PNG GitHub Action (04.OneDrive-Personal-
PDF-Scan.py / OneDrive-Personal-PDF-Scan.yml).

WHY A SEPARATE BOOTSTRAP:
  The PDF scanner runs every 30 minutes and therefore uses its OWN, INDEPENDENT
  refresh token so it never touches the shared, low-frequency refresh token
  (a_cnmas_top/Family-tracker/automation/rt.enc) used by the summarizer /
  finance / wallpaper workflows. Azure AD allows multiple concurrent refresh
  tokens for the same account + app, so this token lives completely separately.

WHAT IT DOES (run ONCE, locally, on a network WITHOUT corporate SSL inspection
-- e.g. home wifi or phone hotspot):

  1. Signs you in to your PERSONAL Microsoft account via the OAuth "device code"
     flow (no browser redirect / no localhost needed).
  2. Obtains a long-lived *refresh token* (thanks to offline_access).
  3. Prints the refresh token to paste into the GitHub Secret
     ONEDRIVE_REFRESH_TOKEN_PDF.

It deliberately does NOT write or read any rt.enc file, so running it can never
clobber the shared refresh token used by the other workflows.

USAGE:
    pip install requests
    python bootstrap_pdf_rt.py            # will prompt for the client ID
    python bootstrap_pdf_rt.py <client_id>

The Application (client) ID is the same Entra app registration already used by
the other OneDrive workflows (ONEDRIVE_CLIENT_ID). The registration must:
  - support "Personal Microsoft accounts"
  - have "Allow public client flows" = Yes
  - have delegated Graph permission Files.ReadWrite.All
"""

import os
import sys
import time

import requests

# consumers = personal Microsoft accounts only.
AUTHORITY = "https://login.microsoftonline.com/consumers"
DEVICECODE_URL = AUTHORITY + "/oauth2/v2.0/devicecode"
TOKEN_URL = AUTHORITY + "/oauth2/v2.0/token"

# offline_access -> refresh token; Files.ReadWrite.All to read PDFs and write
# the PNG pages back into ZZ.Temp.
SCOPES = "offline_access Files.ReadWrite.All User.Read"


def main():
    client_id = (sys.argv[1] if len(sys.argv) > 1 else input(
        "Enter the Application (client) ID (same as ONEDRIVE_CLIENT_ID): "
    )).strip()
    if not client_id:
        print("No client id given. Aborting.")
        sys.exit(1)

    # 1. Ask for a device code.
    r = requests.post(DEVICECODE_URL, data={
        "client_id": client_id,
        "scope": SCOPES,
    })
    if not r.ok:
        print("devicecode request failed:", r.status_code, r.text)
        sys.exit(1)
    dc = r.json()

    print("\n" + "=" * 60)
    print("To sign in, open this URL in a browser (on a NON-corporate network):")
    print("   ", dc["verification_uri"])
    print("and enter this code:")
    print("   ", dc["user_code"])
    print("=" * 60 + "\n")
    print("Waiting for you to complete sign-in...")

    device_code = dc["device_code"]
    interval = int(dc.get("interval", 5))

    # 2. Poll the token endpoint until the user finishes signing in.
    refresh_token = None
    deadline = time.time() + int(dc.get("expires_in", 900))
    while time.time() < deadline:
        time.sleep(interval)
        tr = requests.post(TOKEN_URL, data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": client_id,
            "device_code": device_code,
        })
        data = tr.json()
        if tr.ok:
            refresh_token = data.get("refresh_token")
            break
        err = data.get("error")
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            interval += 5
            continue
        print("Sign-in failed:", err, "-", data.get("error_description", ""))
        sys.exit(1)

    if not refresh_token:
        print("Timed out waiting for sign-in (or no refresh token returned).")
        print("Make sure 'offline_access' is allowed and the app supports "
              "personal accounts + public client flows.")
        sys.exit(1)

    # 3. Print the refresh token to paste into the GitHub Secret.
    print("\nSUCCESS. Set these GitHub repository Secrets "
          "(Settings -> Secrets and variables -> Actions):\n")
    print("  ONEDRIVE_CLIENT_ID          =", client_id)
    print("  ONEDRIVE_REFRESH_TOKEN_PDF  =", refresh_token)
    print("\nAlso add a PAT with 'secrets: write' permission as:")
    print("  GH_PAT_SECRETS              = <your fine-grained/classic PAT>")
    print("\nThis refresh token is INDEPENDENT of the shared automation/rt.enc, "
          "so the every-30-min scanner will not disturb the other workflows.")
    print("\nIMPORTANT: never commit the plaintext refresh token; it lives ONLY "
          "in the ONEDRIVE_REFRESH_TOKEN_PDF Secret (GitHub encrypts it at rest, "
          "and the scanner rotates it via the API each run).")


if __name__ == "__main__":
    main()
