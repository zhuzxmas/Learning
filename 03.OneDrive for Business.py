import json, requests, datetime, os
from pandas import DataFrame
from datetime import datetime, timezone
import funcLG

login_return_secret = funcLG.func_login_secret() # to login into MS365 and get the return value info.
result_secret = login_return_secret['result']
access_token_secret = result_secret['access_token']
login_return_refresh = funcLG.get_refresh_token_from_SP(access_token_secret)
refresh_token = login_return_refresh[0]
refresh_token_obtained_date_str = login_return_refresh[1]
proxies = login_return_secret['proxies']

# Parse the datetime string into a timezone-aware datetime object.
refresh_token_obtained_date_date = datetime.fromisoformat(refresh_token_obtained_date_str.replace('Z', '+00:00'))

# Get current time in UTC (timezone-aware)
now_date = datetime.now(timezone.utc)

# Calculate the difference
delta_days_date = now_date - refresh_token_obtained_date_date 

# Get the number of days (as a float, but we can use .days for whole days)
delta_days_number = delta_days_date.days

# Check condition
if delta_days_number < 40:
    print("Refresh Token is still ok to use.\n")
else:
    print("Refresh Token will expire soon, let's update it now...\n")


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