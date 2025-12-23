import base64
import requests
import nacl.public
import json
import requests
import configparser
import os

config = configparser.ConfigParser()
# to check if local file config.cfg is available, for local application
if os.path.exists('./config.cfg'):
    config.read(['config.cfg'])

    proxy_settings = config['proxy_add']
    github_settings = config['Git_Hub']

    proxy_add = proxy_settings['proxy_add']
    GITHUB_TOKEN = github_settings['git_hub_token']
else:  # to get this info from Github Secrets,, for Github Action running application
    proxy_add = os.environ['proxy_add']
    GITHUB_TOKEN = os.environ['git_hub_token']

proxies = {
    "http": proxy_add,
    "https": proxy_add
}


def update_Github_Repo_Secret(OWNER, REPO, SECRET_NAME, SECRET_VALUE):

    # GitHub API URLs:
    PUBLIC_KEY_URL = f"https://api.github.com/repos/{OWNER}/{REPO}/actions/secrets/public-key"
    SECRET_URL = f"https://api.github.com/repos/{OWNER}/{REPO}/actions/secrets/{SECRET_NAME}"

    headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }

    # Step 1: Get the repository's public key and key ID
    try:
        response = requests.get(PUBLIC_KEY_URL, headers=headers)
    except:
        response = requests.get(
            PUBLIC_KEY_URL, headers=headers, proxies=proxies)
    response.raise_for_status()
    key_data = response.json()
    public_key = nacl.public.PublicKey(base64.b64decode(key_data["key"]))
    key_id = key_data["key_id"]

    # Step 2: Encrypt the secret value
    sealed_box = nacl.public.SealedBox(public_key)
    encrypted = sealed_box.encrypt(SECRET_VALUE.encode("utf-8"))
    encrypted_b64 = base64.b64encode(encrypted).decode("utf-8")

    # Step 3: Update the secret
    payload = {
        "encrypted_value": encrypted_b64,
        "key_id": key_id
    }

    try:
        put_response = requests.put(SECRET_URL, headers=headers, json=payload)
    except:
        put_response = requests.put(
            SECRET_URL, headers=headers, json=payload, proxies=proxies)
    put_response.raise_for_status()

    print(f"Secret '{SECRET_NAME}' updated successfully in Github {OWNER}/{REPO}")


# Example usage:
if __name__ == "__main__":
    # Configuration
    OWNER = "zhuzxmas"
    REPO = "Learning"
    config = configparser.ConfigParser()
    # to check if local file config.cfg is available, for local application
    if os.path.exists('./config.cfg'):
        config.read(['config.cfg'])
        for section in config.sections():
            print(f"Section: {section}")
            for key, value in config.items(section):
                SECRET_NAME =  key         # Replace with your secret name
                SECRET_VALUE = value     # Replace with actual secret value
                update_Github_Repo_Secret(OWNER, REPO, SECRET_NAME, SECRET_VALUE)
