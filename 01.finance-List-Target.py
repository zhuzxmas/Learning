import requests
import pandas as pd
import time
import datetime
import z_Func
import funcLG
import os

login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
result = login_return['result']
proxies = login_return['proxies']

df_300 = z_Func.get_SH_SZ_300_list_from_eas_mon()
df_all = z_Func.get_SH_SZ_All_list_from_eas_mon()

df_300_new = df_300.join(df_all[['BASIC_EPS']], how='left')
df_300_new['BASIC_EPS'] = pd.to_numeric(df_300_new['BASIC_EPS'], errors='coerce')
df_300_new['f2'] = pd.to_numeric(df_300_new['f2'], errors='coerce')
df_300_new['市盈率-基于最新年报'] = (df_300_new['f2']/df_300_new['BASIC_EPS']).round(2)
df_300_new_sorted = df_300_new.sort_values(by='市盈率-基于最新年报', ascending=True)

page_content = df_300_new_sorted.to_html()

### to get the user_id first... ####
# the endpoint shall not use /me, use [users] instead...
endpoint = 'https://graph.microsoft.com/v1.0/users/'
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
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

time.sleep(3)

### to get the parent id info from OD, i.e.: Saved_files_python folder ID ###
endpoint_parent = 'https://graph.microsoft.com/v1.0/users/{}/drive/root:/Files/Spending and Income/StockInvest/Saved_files_python/'.format(user_id)
try:
    data_get_parent = requests.get(endpoint_parent, headers=http_headers, stream=False)
except:
    data_get_parent = requests.get(endpoint_parent, headers=http_headers, stream=False, proxies=proxies)
if data_get_parent.status_code == 200:
    print('Successfully get the parent id info from OneDrive.\n')
else:
    print('Failed to get the parent id: Status code is: {}'.format(data_get_parent.status_code))
parent_id = data_get_parent.json()['id']

page_title = '沪深300 Stock info'
create_page_initial = """
<!DOCTYPE html>
<html>
<head>
<title>{}</title>
<meta name="created" content="{}" />
</head>
<body>
<!-- No content in the body -->
<div><p>{}</p></div>
</body>
</html>
""".format(page_title,(datetime.datetime.now(datetime.timezone.utc)+ datetime.timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%S+08:00'),page_title).replace('\n','').strip()

with open(f'{page_title}.html', "a", encoding='utf-8') as file:
    file.write(create_page_initial)
print(f"File saved successfully to: {page_title}.html for OneNote page\n")


with open(f'{page_title}.html', "a", encoding="utf-8") as file:  # Open in append mode
    file.write(page_content)
print(f'Data Added to File {page_title}.html successfully for OneNote page! \n')

html_files = [file for file in os.listdir('.') if file.endswith('.html')]
print("HTML files in the current directory:")
print(html_files)

for file in html_files:
    z_Func.Save_File_To_OneDrive(file=file, user_id=user_id, parent_id=parent_id, result=result, proxies=proxies)

print('Task Completed Successfully! \n')
