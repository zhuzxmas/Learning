import funcLG
import requests

login_return_secret = funcLG.func_login_secret() # to login into MS365 and get the return value info.
result_secret = login_return_secret['result']
access_token_secret = result_secret['access_token']
proxies = login_return_secret['proxies']

File_ID = 'b!xffZdpd4YESDjLdN0Cq5v8nw5q7AyqpGmqCBv_YRp666chyUVvwSSZLyY1S5yMDc.01L7SVHISXEAVEETMLRVE2LV5GLHAOH2T3'
File_Path = '/drives/b!xffZdpd4YESDjLdN0Cq5v8nw5q7AyqpGmqCBv_YRp666chyUVvwSSZLyY1S5yMDc/root:/Pictures/zz/Scan from 2026-01-10 12_18_35 PM.pdf'
File_Name_With_Extension = 'Scan from 2026-01-10 12_18_35 PM.pdf'

### to get the user_id first... ####
# the endpoint shall not use /me, use [users] instead...
endpoint = 'https://graph.microsoft.com/v1.0/users/'
http_headers = {'Authorization': 'Bearer ' + access_token_secret,
                'Accept': 'application/json',
                'Content-Type': 'application/json'}

try:
    data = requests.get(endpoint, headers=http_headers,
                        stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers,
                        stream=False, proxies=proxies).json()
for i in range(0, len(data['value'])):
    if data['value'][i]['givenName'] == 'Nathan':
        user_id = data['value'][i]['id']

# https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0&tabs=http
# check the link for the manual
endpoint = 'https://graph.microsoft.com/v1.0/users/{}/drive/items/{}/content'.format(user_id, File_ID.split('.')[-1])
http_headers = {'Authorization': 'Bearer ' + access_token_secret}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False)
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies)