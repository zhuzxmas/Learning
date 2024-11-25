import requests, json
import funcLG

login_return = funcLG.func_login_secret() # to login into MS365 and get the return value info.
result = login_return['result']
proxies = login_return['proxies']

key_deeplx = funcLG.get_deeplx_key()

endpoint = 'https://api.deeplx.org/{}/translate'.format(key_deeplx)
http_headers = {
  'Content-Type': 'application/json'
}

input_data = {
  "text": "Hello, world!",
  "source_lang": "auto",
  "target_lang": "ZH"
}

payload = json.dumps(input_data)

try:
    data = requests.post(endpoint, headers=http_headers, stream=False, data=payload).json()
except:
    data = requests.post(endpoint, headers=http_headers, stream=False, proxies=proxies, data=payload).json()