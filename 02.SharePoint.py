import json, requests, datetime, os
from pandas import DataFrame
import funcLG

login_return = funcLG.func_login() # to login into MS365 and get the return value
result = login_return['result']
proxies = login_return['proxies']

endpoint = 'https://graph.microsoft.com/v1.0/sites?search={cnmas}'
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()
output = data['value']

# to get the site id for below SP address:
for i in range(0,len(output)):
    if output[i]['webUrl'] == 'https://cnmas.sharepoint.com/sites/cmmas':
        site_id = output[i]['id'].split(',')[1]

# to list site pages:
endpoint = 'https://graph.microsoft.com/v1.0/sites/{}/pages'.format(site_id)
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()

# to create a new page in SP:
endpoint = 'https://graph.microsoft.com/v1.0/sites/{}/pages'.format(site_id)
try:
    data = requests.post(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.post(endpoint, headers=http_headers, stream=False, proxies=proxies).json()
