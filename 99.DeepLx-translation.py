import requests
import funcLG

key_deeplx = funcLG.get_deeplx_key()

endpoint = 'https://api.deeplx.org/{}/translate'.format(key_deeplx)
try:
    data = requests.post(endpoint, headers=http_headers, stream=False, data=page_body).json()
except:
    data = requests.post(endpoint, headers=http_headers, stream=False, proxies=proxies, data=page_body).json()