import requests
import json
import os, configparser
import time

config = configparser.ConfigParser()
if os.path.exists('./config.cfg'): # to check if local file config.cfg is available, for local application
    config.read(['config.cfg'])
    proxy_settings = config['proxy_add']
    proxy_add = proxy_settings['proxy_add']

proxies = {
  "http": proxy_add,
  "https": proxy_add
}

# --- Configuration ---
# Replace with your Application (client) ID from Azure AD registration
CLIENT_ID = "d85a5f93-4dd1-4bec-84ac-f3a9e2953e43"

# Define the scopes your application needs.
# Use 'Files.ReadWrite' for app-specific file access, or 'Files.ReadWrite.All' for broader access.
# 'offline_access' is crucial for getting a refresh token.
SCOPE = "Files.ReadWrite.All offline_access" # Or "Files.ReadWrite offline_access"

# Microsoft Identity Platform endpoint for personal accounts (consumers)
DEVICE_CODE_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode"
TOKEN_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"

# Microsoft Graph API endpoint
GRAPH_API_ENDPOINT = "https://graph.microsoft.com/v1.0/me/drive/root/children" # Lists items in the root of personal OneDrive

# --- Step A: Request Device Code ---
def get_device_code(client_id: str, scope: str):
    """
    Initiates the device code flow by requesting a device code and user verification URI.
    """
    headers = {
        "Content-Type": "application/x-www-form-urlencoded"
    }
    data = {
        "client_id": client_id,
        "scope": scope
    }

    print(f"Requesting device code from: {DEVICE_CODE_ENDPOINT}")
    print(f"  Client ID: {client_id}")
    print(f"  Scope: {scope}")

    try:
        response = requests.post(DEVICE_CODE_ENDPOINT, headers=headers, data=data, proxies=proxies)
        response.raise_for_status() # Raises an HTTPError for bad responses (4xx or 5xx)
        device_code_response = response.json()

        return device_code_response

    except requests.exceptions.HTTPError as errh:
        print(f"HTTP Error: {errh}")
        print(f"Response content: {response.text}")
    except requests.exceptions.ConnectionError as errc:
        print(f"Error Connecting: {errc}")
    except requests.exceptions.Timeout as errt:
        print(f"Timeout Error: {errt}")
    except requests.exceptions.RequestException as err:
        print(f"Something went wrong: {err}")
    except json.JSONDecodeError:
        print(f"Failed to decode JSON from response: {response.text}")
    return None

# --- Step C: Poll for Access Token ---
def poll_for_tokens(client_id: str, device_code: str, interval: int, expires_in: int):
    """
    Polls the token endpoint until the user authorizes the app, the code expires,
    or the user denies access.
    """
    headers = {
        "Content-Type": "application/x-www-form-urlencoded"
    }
    data = {
        "client_id": client_id,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": device_code
    }

    start_time = time.time()
    while True:
        if time.time() - start_time > expires_in:
            print("\nError: Device code expired. Please restart the login process.")
            return None

        print(f"Polling for token... (next poll in {interval} seconds)")
        try:
            response = requests.post(TOKEN_ENDPOINT, headers=headers, data=data, proxies=proxies)
            response.raise_for_status()
            token_data = response.json()

            if "access_token" in token_data:
                print("\nSuccessfully obtained access and refresh tokens!")
                return token_data
            elif token_data.get("error") == "authorization_pending":
                # User hasn't completed authorization yet, continue polling
                pass
            elif token_data.get("error") == "access_denied":
                print("\nError: User denied access to the application.")
                return None
            elif token_data.get("error") == "expired_token":
                print("\nError: Device code expired during polling. Please restart the login process.")
                return None
            else:
                print(f"\nUnexpected error during polling: {token_data.get('error_description', token_data)}")
                return None

        except requests.exceptions.RequestException as err:
            print(f"Error during token polling: {err}")
            if hasattr(err, 'response') and err.response is not None:
                print(f"Response content: {err.response.text}")
            # Don't return immediately, maybe it's a transient network issue
        except json.JSONDecodeError:
            print(f"Failed to decode JSON from token response: {response.text}")
            # Don't return immediately, maybe it's a transient issue

        time.sleep(interval)

    return None

# --- Part 3: Access OneDrive using Microsoft Graph ---
def list_onedrive_root_children(access_token: str):
    """
    Uses the access token to call Microsoft Graph and list items in the OneDrive root.
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    print(f"\nAttempting to access OneDrive root: {GRAPH_API_ENDPOINT}")
    try:
        graph_response = requests.get(GRAPH_API_ENDPOINT, headers=headers, proxies=proxies)
        graph_response.raise_for_status() # Raises an HTTPError for bad responses (4xx or 5xx)
        onedrive_data = graph_response.json()

        print("\n--- OneDrive Root Contents ---")
        if onedrive_data and "value" in onedrive_data:
            if not onedrive_data["value"]:
                print("Your OneDrive root folder is empty or contains no visible items.")
            else:
                for item in onedrive_data["value"]:
                    item_type = "Folder" if "folder" in item else "File"
                    size_info = f" ({item.get('size', 0)} bytes)" if "size" in item else ""
                    print(f"- {item['name']} ({item_type}){size_info}")
        else:
            print("No items found in OneDrive root or unexpected response structure.")

    except requests.exceptions.RequestException as err:
        print(f"Error accessing Microsoft Graph API: {err}")
        if hasattr(err, 'response') and err.response is not None:
            print(f"Graph API Error Response: {err.response.text}")
    except json.JSONDecodeError:
        print(f"Failed to decode JSON from Graph API response: {graph_response.text}")

# --- Main execution flow ---
if __name__ == "__main__":
    if CLIENT_ID == "YOUR_APPLICATION_CLIENT_ID_HERE":
        print("ERROR: Please replace 'YOUR_APPLICATION_CLIENT_ID_HERE' with your actual Azure AD Application (client) ID.")
    else:
        # 1. Get device code and user instructions (Step A)
        device_info = get_device_code(CLIENT_ID, SCOPE)

        if device_info:
            user_code = device_info.get("user_code")
            verification_uri = device_info.get("verification_uri")
            device_code_for_polling = device_info.get("device_code")
            expires_in = device_info.get("expires_in")
            interval = device_info.get("interval")

            print("\n--- User Authorization Required ---")
            print(f"1. Open your web browser and go to: \033[1m{verification_uri}\033[0m") # Bold text
            print(f"2. Enter the following code when prompted: \033[1m{user_code}\033[0m") # Bold text
            print(f"   (This code expires in {expires_in} seconds.)")
            print("\nWaiting for user to complete authorization...")

            # 2. Poll for tokens (Step C)
            tokens = poll_for_tokens(CLIENT_ID, device_code_for_polling, interval, expires_in)

            if tokens:
                access_token = tokens.get("access_token")
                refresh_token = tokens.get("refresh_token")
                expires_in_access = tokens.get("expires_in")

                print("\n--- Tokens Obtained ---")
                print(f"Access Token (valid for {expires_in_access} seconds): {access_token[:30]}...") # Print first 30 chars
                print(f"Refresh Token: {refresh_token[:30]}...") # Print first 30 chars
                print("\nIMPORTANT: Store the refresh_token securely! It allows you to get new access tokens.")

                # 3. Access OneDrive using the obtained access_token (Part 3)
                list_onedrive_root_children(access_token)

            else:
                print("Failed to obtain tokens.")
        else:
            print("Failed to get device code. Cannot proceed to polling.")