# -*- coding:utf-8 -*-
import funcLG
import configparser
import os
import requests
import funcLG
import datetime
import pickle
import pandas as pd

stock_number_str = input('Please input the stock number, such as 600888 : \n')

# to check if local file config.cfg is available, for local running application.
config = configparser.ConfigParser()
if os.path.exists('./config.cfg'):
    config.read(['config.cfg'])
    proxy_settings = config['proxy_add']
    if os.getlogin() == 'cindy.rao':
        proxy_add = None
    else:
        proxy_add = proxy_settings['proxy_add']
else:
    proxy_add = None

login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
result = login_return['result']
proxies = login_return['proxies']
finance_section_id = login_return['finance_section_id']
token_start_time = datetime.datetime.now()
site__id_personal_z = login_return['site__id_personal_z']
site__id_cmmas = login_return['site__id_cmmas']

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

### to search for the saved  Yearly data file for the target stock:
endpoint_target_stock = 'https://graph.microsoft.com/v1.0/users/{}/drive/items/{}/children'.format(user_id, parent_id)
try:
    data_get_stock = requests.get(endpoint_target_stock, headers=http_headers, stream=False)
except:
    data_get_stock = requests.get(endpoint_target_stock, headers=http_headers, stream=False, proxies=proxies)
if data_get_stock.status_code == 200:
    print('Successfully get the Saved Yearly files list from OneDrive.\n')
    stock_data_list_OD = data_get_stock.json()['value']
    stock_data_list_OD_lite = {}
    for i in range(len(stock_data_list_OD)):
        file_name = stock_data_list_OD[i]['name']
        if stock_number_str in file_name:
            if '-Y-' in file_name:
                data_file_id = stock_data_list_OD[i]['id']
                stock_data_list_OD_lite[file_name] = data_file_id
    # print(stock_data_list_OD_lite)

    ### to get the file content
    endpoint_data_file_content = 'https://graph.microsoft.com/v1.0/users/' + '/{}/drive/items/{}/content'.format(user_id, data_file_id)
    try:
        data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False)
    except:
        data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False, proxies=proxies)
    yearly_report_from_OD = pickle.loads(data_get_data_content.content)
    profit_data = yearly_report_from_OD.loc['稀释后 每年/季度每股收益 元']
    for i in range(len(profit_data.keys())):
        if pd.isna(profit_data[profit_data.keys()[i]]) is True:
            print('You need to input this info manually: \n')
            profit_data_str = input('[{}][稀释后 每年/季度每股收益 元] = '.format(profit_data.keys()[i]))
            yearly_report_from_OD.loc[profit_data.keys()[i],'稀释后 每年/季度每股收益 元'] = float(profit_data_str)
            pass
            #TODO


else:
    print('Failed to get the Saved Yearly files list: Status code is: {}'.format(data_get_stock.status_code))