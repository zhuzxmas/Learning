import json, requests, datetime, os
from pandas import DataFrame
from datetime import datetime
import funcLG

login_return = funcLG.func_login() # to login into MS365 and get the return value info.
result = login_return['result']
proxies = login_return['proxies']

# to get the Pictures folder id from OneDrive for Business:

endpoint = 'https://graph.microsoft.com/v1.0/me/drive/root/children'
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()
for i in range(0, len(data['value'])):
    if data['value'][i]['name'] == 'Pictures':
        Picture_folder_id = data['value'][i]['id']

# to get the sub-folder within Pictures.
endpoint = 'https://graph.microsoft.com/v1.0/me/drive/items/{}/children'.format(Picture_folder_id)
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()

# to sort the pages by date, from latest to oldest ones:
data = data['value']
data = sorted(data, key=lambda x: datetime.fromisoformat(x['lastModifiedDateTime'].replace("Z", "+00:00")),reverse=True)
last_modified_folder_id = data[0]['id']
last_modified_folder_name = data[0]['name']

# to get the Favorites pictures I marked:

endpoint = 'https://graph.microsoft.com/v1.0/me/drive/items/{}/children?$select=id,name,isFavorite'.format(last_modified_folder_id)
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()

'''
https://graph.microsoft.com/v1.0/drives/{}/items/{}/children?$select=id,name,isFavorite
https://graph.microsoft.com/v1.0/users/{}/drives/{}/items/{}/children?$select=id,name,isFavorite

# tbd
'''