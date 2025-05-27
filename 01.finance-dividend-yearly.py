# -*- coding:utf-8 -*-
import funcLG
import z_Func
from tabulate import tabulate
import configparser
import os
import requests
import funcLG
import datetime
import pickle
import pandas as pd

login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
result = login_return['result']
proxies = login_return['proxies']
finance_section_id = login_return['finance_section_id']
token_start_time = datetime.datetime.now()
site_id = login_return['site_id']
site_id_for_sp = login_return['site_id_for_sp']

stock_code = []

# to get the list id and relative info:
# visit Microsoft Graph API Reference Document https://learn.microsoft.com/en-us/graph/api/site-get?view=graph-rest-1.0 for more information.
# if  list_url = 'https://xxx-my.sharepoint.com/personal/xxx_yyy_onmicrosoft_com/Lists/Learning_records/AllItems.aspx'
# then  endpoint_for_site_id = 'https://graph.microsoft.com/v1.0/sites/xxx-my.sharepoint.com:/personal/xxx_yyy_onmicrosoft_com/'
# data = requests.get(endpoint_for_site_id, headers=http_headers, stream=False).json()
# site_id = data['id'].split(',')[1]

# to get the list item info, which is needed for creating new lists item
endpoint_list = "https://graph.microsoft.com/v1.0/sites/{}/lists/Stock_Code_list/items?$expand=fields($select=Title)".format(site_id_for_sp)
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

# stock_number_str = input('Please input the stock number, such as 600888 : \n')
for stock_number_str in stock_code:
    if stock_number_str != 'F':
        if stock_number_str == 'F':
            stock = 'F'
        else:
            if len(str(stock_number_str)) == 6:
                if str(stock_number_str)[0] == '6':  # SH stock
                    stock = str(stock_number_str) + '.ss'  # SH stock
                    stock_cn = str(stock_number_str) + '.SH'  # SH stock
                else:
                    stock = str(stock_number_str) + '.sz'  # SZ stock
                    stock_cn = str(stock_number_str) + '.SZ'  # SZ stock
            else:
                len_temp = 6 - len(str(stock_number_str))
                prefix = ''
                for ii in range(0, len_temp):
                    prefix = prefix + '0'
                stock = prefix + str(stock_number_str) + '.sz'  # SZ stock
                stock_cn = prefix + str(stock_number_str) + '.SZ'  # SZ stock


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
            # print(stock_data_list_OD_lite)     # print it out

            ### to get the file content
            endpoint_data_file_content = 'https://graph.microsoft.com/v1.0/users/' + '/{}/drive/items/{}/content'.format(user_id, data_file_id)
            try:
                data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False)
            except:
                data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False, proxies=proxies)
            yearly_report_from_OD = pickle.loads(data_get_data_content.content)
            dividend_for_report_year = yearly_report_from_OD.columns.to_list()
            dividend_data = z_Func.Dividend_Data_Yearly_from_Eas_Mon(stock_cn,proxies)
            dividend_total_dict = {}
            dividend_cash_dict = {}
            for dividend_Y_M_D in dividend_for_report_year:
                for i in range(len(dividend_data)):
                    if dividend_data[i]['REPORT_DATE'].split(' ')[0] == dividend_Y_M_D:
                        dividend_total_dict[dividend_Y_M_D] = dividend_data[i]['IMPL_PLAN_PROFILE']
                        dividend_cash_dict[dividend_Y_M_D] = dividend_data[i]['PRETAX_BONUS_RMB']/10
            dividend_total_dict_df = pd.Series(dividend_total_dict)
            dividend_cash_dict_df = pd.Series(dividend_cash_dict)
            # dividend_total_dict_df = dividend_total_dict_df/yearly_report_from_OD.loc['普通股数量 百万']/1000000
            dividend_total_dict_df.name = '每股派发股息'
            dividend_cash_dict_df.name = '每股派发现金股息'
            dividend_per_share_vs_profit = dividend_cash_dict_df/yearly_report_from_OD.loc['稀释后 每年/季度每股收益 元']
            dividend_per_share_vs_profit.name = '每股派发股息/每股收益 占比'
            dividend_total_dict_df = pd.DataFrame(dividend_total_dict_df).T
            dividend_cash_dict_df = pd.DataFrame(dividend_cash_dict_df).T.astype('float64').round(2)
            dividend_per_share_vs_profit = pd.DataFrame(dividend_per_share_vs_profit).T.astype('float64').round(2)
            yearly_report_from_OD_new = pd.concat([dividend_total_dict_df, dividend_cash_dict_df, dividend_per_share_vs_profit], axis=0, ignore_index=False).drop_duplicates()
            yearly_report_from_OD.update(yearly_report_from_OD_new)
            temp_out_df = pd.concat([yearly_report_from_OD,yearly_report_from_OD_new[~yearly_report_from_OD_new.index.isin(yearly_report_from_OD.index)]])
            yearly_report_from_OD_new = temp_out_df
            print(tabulate(yearly_report_from_OD_new, headers='keys', tablefmt='simple'))
            yearly_report_from_OD_new.to_pickle('temp.pkl')
            with open('temp.pkl','rb') as filedata:
                endpoint_update_file = endpoint_data_file_content
                try:
                    data_update_file = requests.put(endpoint_update_file, headers=http_headers, data=filedata, stream=False)
                except:
                    data_update_file = requests.put(endpoint_update_file, headers=http_headers, data=filedata, stream=False, proxies=proxies)
                print('Updated Yearly data file: status code is: {}----\n'.format(data_update_file.status_code))
                if data_update_file.status_code == 200:
                    print('Yearly Data file updated to OneDrive Successfully!-------- \n')
            os.remove('temp.pkl')



        else:
            print('Failed to get the Saved Yearly files list: Status code is: {}'.format(data_get_stock.status_code))