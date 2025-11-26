# -*- coding:utf-8 -*-

import yfinance as yf
import pandas as pd
from tabulate import tabulate
import configparser
import os
import requests
import time
import random
import datetime
import json
import funcLG
from pandas import DataFrame as df
import pickle
import z_Func

### stock_Top_list is to summarize the performance of each  stock
stock_Top_list = []
stock_Top_list_columns = ['Stock Number', '利润表现好', '流动负债不高', '分红多']


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

### to define the date for today, in order to get the year info ###
day_one = datetime.date.today()


# =====Basic Info from EasMon=====#
p_cash_flow = 'CASHFLOW'
p_balance_sheet = 'BALANCE'
p_income = 'INCOMEQC'
p_income_year = 'INCOME'

# config.read(['config1.cfg'])
# stock_settings = config['stock_name']
# stock = stock_settings['stock_name']


######## Below is the Main Function #################################

login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
result = login_return['result']
proxies = login_return['proxies']
finance_section_id = login_return['finance_section_id']
token_start_time = datetime.datetime.now()
site__id_personal_z = login_return['site__id_personal_z']
site__id_cmmas = login_return['site__id_cmmas']

stock_code = []


# to get the list item info, which is needed for creating new lists item
endpoint_list = "https://graph.microsoft.com/v1.0/sites/{}/lists/Stock_Code_list/items?$expand=fields($select=Title)".format(site__id_cmmas)
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data_list = requests.get(endpoint_list, headers=http_headers, stream=False)
except:
    data_list = requests.get(endpoint_list, headers=http_headers,
                        stream=False, proxies=proxies)
if data_list.status_code == 200:
    for item in data_list.json()['value']:
        stock_code.append(item['fields']['Title'].replace(' ', ''))

print(stock_code)

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

### to get the Saved Files List info from OD ###
endpoint_parent_items = 'https://graph.microsoft.com/v1.0/users/{}/drive/items/{}/children'.format(user_id, parent_id)
try:
    data_get_parent_items = requests.get(endpoint_parent_items, headers=http_headers, stream=False)
except:
    data_get_parent_items = requests.get(endpoint_parent_items, headers=http_headers, stream=False, proxies=proxies)
if data_get_parent_items.status_code == 200:
    print('Successfully get the Saved Files list from OneDrive.\n')
else:
    print('Failed to get the Saved Files list from OneDrive: Status code is: {}'.format(data_get_parent.status_code))
saved_files_list_from_OD = data_get_parent_items.json()['value']
saved_files_list_lite = {}
if len(saved_files_list_from_OD) == 0:
    print('------------No file has been saved in yet.\n')
else:
    for i in range(len(saved_files_list_from_OD)):
        saved_files_list_lite[saved_files_list_from_OD[i]['name']] = saved_files_list_from_OD[i]['id']


for iii in range(0, len(stock_code)):  # 在所有的沪深300成分股里面进行查询..
    if stock_code[iii] == 'F':
        stock = 'F'
    else:
        if len(str(stock_code[iii])) == 6:
            if str(stock_code[iii])[0] == '6':  # SH stock
                stock = str(stock_code[iii]) + '.ss'  # SH stock
                stock_cn = str(stock_code[iii]) + '.SH'  # SH stock
            else:
                stock = str(stock_code[iii]) + '.sz'  # SZ stock
                stock_cn = str(stock_code[iii]) + '.SZ'  # SZ stock
        else:
            len_temp = 6 - len(str(stock_code[iii]))
            prefix = ''
            for ii in range(0, len_temp):
                prefix = prefix + '0'
            stock = prefix + str(stock_code[iii]) + '.sz'  # SZ stock
            stock_cn = prefix + str(stock_code[iii]) + '.SZ'  # SZ stock

    data_old_id = saved_files_list_lite[stock+'.pkl']

    check_item = ['yearly']

    for check_item_name in check_item:
        if check_item_name == 'yearly' and stock != 'F':
            # endpoint_data_file = endpoint_parent + '{}.pkl'.format(stock)
            stock_file_str = stock + '-Y-'
        else:
            # endpoint_data_file = endpoint_parent + '{}.pkl'.format(stock)
            stock_file_str = stock + '-Y-'

        http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'}

        ### to check  if data exists: ####
        found = False
        ##### data exists ####
        for key in saved_files_list_lite.keys():
            if stock_file_str in key:
                found = True
                print(f"Found '{stock_file_str}' in saved files from OneDrive: {key}\n")
                endpoint_data_file = endpoint_parent + key
                data_file_id = saved_files_list_lite[key]
                if check_item_name == 'yearly':
                    stock_name = key.split('-Y-')[1].split('.pkl')[0]
                if check_item_name == 'monthly' and stock != 'F':
                    stock_name = key.split('-M-')[1].split('.pkl')[0]

                if check_item_name == 'yearly' and stock != 'F':
                    print('-----Data existed in OneDrive, let\'s check if it is updated base on saved data latest report year...-----\n')
                elif check_item_name == 'monthly' and stock != 'F':
                    print('-----Data existed in OneDrive, let\'s check if it is updated base on saved data latest report Season...-----\n')
                else:
                    print('-----Data existed in OneDrive for Ford, let\'s check if it is updated base on saved data latest report year...-----\n')

                endpoint_data_file_content = 'https://graph.microsoft.com/v1.0/users/' + '/{}/drive/items/{}/content'.format(user_id, data_file_id)
                endpoint_data_file_content_old = 'https://graph.microsoft.com/v1.0/users/' + '/{}/drive/items/{}/content'.format(user_id, data_old_id)

                try:
                    data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False)
                    data_get_data_content_old = requests.get(endpoint_data_file_content_old, headers=http_headers, stream=False)
                except:
                    data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False, proxies=proxies)
                    data_get_data_content_old = requests.get(endpoint_data_file_content_old, headers=http_headers, stream=False, proxies=proxies)

                if check_item_name == 'yearly' and stock != 'F':
                    yearly_report_from_OD_new = pickle.loads(data_get_data_content.content)
                    yearly_report_from_OD_old = pickle.loads(data_get_data_content_old.content)
                elif check_item_name == 'monthly' and stock != 'F':
                    Seasonly_report_from_OD_new = pickle.loads(data_get_data_content.content)
                    Seasonly_report_from_OD_old = pickle.loads(data_get_data_content_old.content)
                else:
                    yearly_report_from_OD_new = pickle.loads(data_get_data_content.content)
                    yearly_report_from_OD_old = pickle.loads(data_get_data_content_old.content)

                temp_output = pd.merge(yearly_report_from_OD_new, yearly_report_from_OD_old, left_index=True, right_index=True, suffixes=('', '_y'))
                cols_to_drop = [col for col in temp_output.columns if col.endswith('_y')]
                temp_output.drop(columns=cols_to_drop, inplace=True)

                ### to update the data in OneDrive as well....
                z_Func.update_data_in_OneDrive(stock_name=stock_name, stock_data=temp_output, stock=stock, user_id=user_id, data_file_id=data_file_id, result=result, proxies=proxies)
                print(':::: {} It\'s Yearly data saved to OneDrive ...   ::::\n'.format(stock))