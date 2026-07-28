#!/usr/bin/env python3
"""
One-time bootstrap for the OneDrive summarizer GitHub Action.

WHAT IT DOES (run this ONCE, locally, on a network WITHOUT corporate SSL
inspection -- e.g. home wifi or phone hotspot):

  1. Signs you in to your PERSONAL Microsoft account via the OAuth
     "device code" flow (no browser redirect / no localhost needed).
  2. Obtains a long-lived *refresh token* (thanks to the offline_access scope).
  3. Generates a symmetric encryption key (Fernet) = TOKEN_ENC_KEY.
  4. Encrypts the refresh token and writes it to  automation/rt.enc .
  5. Prints the values you must paste into GitHub repo Secrets.

Afterwards the scheduled Action self-maintains the rolling refresh token inside
rt.enc (committed back to the repo with the built-in GITHUB_TOKEN, no PAT).

USAGE:
    pip install requests cryptography
    python bootstrap.py            # will prompt for the Application (client) ID
    python bootstrap.py <client_id>

The Application (client) ID comes from your Entra app registration
(Azure portal -> App registrations). The registration must:
  - support "Personal Microsoft accounts"
  - have "Allow public client flows" = Yes
  - have delegated Graph permission Files.ReadWrite.All (offline_access is
    included automatically by the flow below)
"""

import sys
import time
import os
import requests
from cryptography.fernet import Fernet

# consumers = personal Microsoft accounts only (matches the SPA's AUTHORITY).
AUTHORITY = "https://login.microsoftonline.com/consumers"
DEVICECODE_URL = AUTHORITY + "/oauth2/v2.0/devicecode"
TOKEN_URL = AUTHORITY + "/oauth2/v2.0/token"

# offline_access -> refresh token; the rest match what the Action needs.
SCOPES = "offline_access Files.ReadWrite.All User.Read"

HERE = os.path.dirname(os.path.abspath(__file__))
RT_ENC_PATH = os.path.join(HERE, "rt.enc")


def main():
    client_id = sys.argv[1] if len(sys.argv) > 1 else input(
        "Enter the Application (client) ID from your Entra app registration: "
    ).strip()
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
        # authorization_declined / expired_token / bad_verification_code / etc.
        print("Sign-in failed:", err, "-", data.get("error_description", ""))
        sys.exit(1)

    if not refresh_token:
        print("Timed out waiting for sign-in (or no refresh token returned).")
        print("Make sure 'offline_access' is allowed and the app supports "
              "personal accounts + public client flows.")
        sys.exit(1)

    # 3. Generate the encryption key and 4. encrypt the refresh token to rt.enc.
    enc_key = Fernet.generate_key()          # bytes, url-safe base64
    f = Fernet(enc_key)
    token_blob = f.encrypt(refresh_token.encode("utf-8"))
    with open(RT_ENC_PATH, "wb") as fh:
        fh.write(token_blob)

    # 5. Tell the user what to configure.
    print("\nSUCCESS. Wrote encrypted refresh token to:")
    print("   ", RT_ENC_PATH)
    print("\nNow set these GitHub repository Secrets "
          "(Settings -> Secrets and variables -> Actions):\n")
    print("  ONEDRIVE_CLIENT_ID     =", client_id)
    print("  TOKEN_ENC_KEY          =", enc_key.decode("utf-8"))
    print("  ONEDRIVE_REFRESH_TOKEN =", refresh_token)
    print("  DEEPSEEK_API_KEY       = <your DeepSeek API key>")
    print("\nThen commit automation/rt.enc to the repo. The Action will keep it "
          "rotated from then on.")
    print("\nIMPORTANT: rt.enc is only safe to commit because it is encrypted "
          "with TOKEN_ENC_KEY, which lives ONLY in Secrets. Never commit "
          "TOKEN_ENC_KEY or the plaintext refresh token.")


if __name__ == "__main__":
    main()
