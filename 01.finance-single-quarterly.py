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

#### Define the stock list you want ####

# https://data.eastmoney.com/other/index/hs300.html 沪深300成分股清单
# stock_code = [600885, 603259, 600276]
# stock_name = ['宏发股份', '药明康德', '恒瑞医药']

### stock_Top_list is to summarize the performance of each stock
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


# =====Basic Info from EastMoney====#
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
site_id = login_return['site_id']
site_id_for_sp = login_return['site_id_for_sp']

# to get the list id and relative info:
# visit Microsoft Graph API Reference Document https://learn.microsoft.com/en-us/graph/api/site-get?view=graph-rest-1.0 for more information.
# if  list_url = 'https://xxx-my.sharepoint.com/personal/xxx_yyy_onmicrosoft_com/Lists/Learning_records/AllItems.aspx'
# then  endpoint_for_site_id = 'https://graph.microsoft.com/v1.0/sites/xxx-my.sharepoint.com:/personal/xxx_yyy_onmicrosoft_com/'
# data = requests.get(endpoint_for_site_id, headers=http_headers, stream=False).json()
# site_id = data['id'].split(',')[1]

# to get the list item info, which is needed for creating new lists item
endpoint = "https://graph.microsoft.com/v1.0/sites/{}/lists/Stock_For_GitHub/items?$expand=fields($select=Title,teamId,ChannelId,replyToMessageId)".format(
    site_id)
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False)
except:
    data = requests.get(endpoint, headers=http_headers,
                        stream=False, proxies=proxies)
if data.status_code == 200:
    print('Successfully get the item info for : Stock_For_GitHub\n')
item_id = data.json()['value'][0]['id']
stock_code_str = data.json()['value'][0]['fields']['Title'].replace(' ', '')
stock_code = [stock_code_str]
teamId = data.json()['value'][0]['fields']['teamId']
channelId = data.json()['value'][0]['fields']['channelId']
replyToMessageId = data.json()['value'][0]['fields']['replyToMessageId']

# to get the list ID, which is needed for delete list item
endpoint = "https://graph.microsoft.com/v1.0/sites/{}/lists".format(site_id)
try:
    data = requests.get(endpoint, headers=http_headers, stream=False)
except:
    data = requests.get(endpoint, headers=http_headers,
                        stream=False, proxies=proxies)
if data.status_code == 200:
    print('Successfully get the list ID for : Stock_For_GitHub\n')
for i in range(0, len(data.json()['value'])):
    if data.json()['value'][i]['name'] == 'Stock_For_GitHub':
        list_id = data.json()['value'][i]['id']

# to delete this list item, i.e., to clear this list content, make it easier for next time info get.
endpoint = "https://graph.microsoft.com/v1.0/sites/{}/lists/{}/items/{}".format(
    site_id, list_id, item_id)
try:
    data = requests.delete(endpoint, headers=http_headers, stream=False)
except:
    data = requests.delete(endpoint, headers=http_headers,
                           stream=False, proxies=proxies)
if data.status_code == 204:
    print('Successfully delete this item from list  Stock_For_GitHub\n')

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

# ################ MS Graph API with APP-Only Token Not Working Any More #################
# #Mar 31, 2025 - Retirement of App-only Authentication for OneNote Microsoft Graph APIs
# #Microsoft is deprecating app-only authentication for Microsoft Graph OneNote APIs. Starting March 31, 2025, requests using application permissions (app-only tokens) will fail with 401 unauthorized errors.
# #Solution: Transition to delegated authentication tokens to prevent access issues.
# #Ref: https://admin.microsoft.com/Adminportal/Home#/MessageCenter/:/messages/MC1011142

# # to create a new page in OneNote to store the stock info...
# # here, only define the endpoint, detailed info is listed down below after the data processing...
# endpoint_create_page = 'https://graph.microsoft.com/v1.0/users/{}/onenote/sections/{}/pages'.format(user_id,finance_section_id)

for iii in range(0, len(stock_code)):  # 在所有的沪深300成分股里面进行查询..

    # ### MS token expiration time info, refer to below link ###
    # # https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes #

    token_time_check = datetime.datetime.now()
    time_difference = token_time_check - token_start_time
    time_difference_s = time_difference.total_seconds()
    print('Token has been used for {} mins.\n'.format(str(int(time_difference_s/60)+1)))

    if time_difference_s > 2400: # check token time, if less than 2400s, i.e. 40min, ok to use, or, get a new one.
        login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
        result = login_return['result']
        http_headers = {'Authorization': 'Bearer ' + result['access_token'],'Content-Type': 'application/json'}
        token_start_time = token_time_check


    # to split the output with 60 stock as the most info in one OneNote page. 
    # ------------ 这里我定义了 OneNote 一页最多放60只股票信息, 为了看的时候方便--------
    if iii % 60 ==0: ### Create a OneNote Page ###

    #     http_headers_create_page = {'Authorization': 'Bearer ' + result['access_token'],
    #                   'Content-Type': 'application/xhtml+xml'}
        page_title = 'Stock info for {} part {}'.format(day_one.strftime('%Y-%m-%d'), str(iii))
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
    #     try:
    #        data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial)
    #     except:
    #        data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial,proxies=proxies)
    #     onenote_page_id = data.json()['id']  # this is the id for OneNote page created above.

    with open(f'{page_title}.html', "w", encoding='utf-8') as file:
        file.write(create_page_initial)
    print(f"File saved successfully to: {page_title}.html for OneNote page\n")

    #     #### Append OneNote page content ###
    #     #### Only endpoint is defined here, detailed info for Append is listed down below after the data processing ###
    #     endpoint = 'https://graph.microsoft.com/v1.0/users/{}/onenote/pages/{}/content'.format(user_id,onenote_page_id)


    ### PREPARE the stock code INFO for main function ###

    # for iii in range(5,7):
    stock_Top_temp = []
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


    print('-----Stock No.{}---Begin of {}: ↓ ↓ ↓ ↓ ↓  ---------------\n'.format(iii, stock))

    ### to get the yearly report from the East Money ################################
    print('------- To Get the [- yearly -] report from DataBase ------------\n')
    

    ### to check if the data is stored in OneDrive, if not, then save it, if yes, then check if it's updated or not.
    ### check OneDrive stored date ###
    ### GET /users/{user-id}/drive/root:/{item-path}
    ### if file not exist, create a new one ###
    ###     call get report from East Money, and save it.
    ###     PUT /users/{user-id}/drive/items/{parent-id}:/{filename}:/content
    ### if file exist, compare the latest report date and today-1.
    ###     get file content: GET /users/{userId}/drive/items/{item-id}/content
    ###     if same, then just read it.
    ###     if not same, then call get report from East Money, and combine it with exist date, and save it.
    ###     PUT /users/{user-id}/drive/items/{item-id}/content


    check_item = ['yearly', 'monthly']

    for check_item_name in check_item:
        if check_item_name == 'yearly' and stock != 'F':
            # endpoint_data_file = endpoint_parent + '{}.pkl'.format(stock)
            stock_file_str = stock + '-Y-'
        elif check_item_name == 'monthly' and stock != 'F':
            # endpoint_data_file = endpoint_parent + '{}_monthly.pkl'.format(stock)
            stock_file_str = stock + '-M-'
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
                if check_item_name == 'monthly':
                    stock_name = key.split('-M-')[1].split('.pkl')[0]

                if check_item_name == 'yearly' and stock != 'F':
                    print('-----Data existed in OneDrive, let\'s check if it is updated base on saved data latest report year...-----\n')
                elif check_item_name == 'monthly' and stock != 'F':
                    print('-----Data existed in OneDrive, let\'s check if it is updated base on saved data latest report Season...-----\n')
                else:
                    print('-----Data existed in OneDrive for Ford, let\'s check if it is updated base on saved data latest report year...-----\n')

                endpoint_data_file_content = 'https://graph.microsoft.com/v1.0/users/' + '/{}/drive/items/{}/content'.format(user_id, data_file_id)

                try:
                    data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False)
                except:
                    data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False, proxies=proxies)

                if check_item_name == 'yearly' and stock != 'F':
                    yearly_report_from_OD = pickle.loads(data_get_data_content.content)
                elif check_item_name == 'monthly' and stock != 'F':
                    Seasonly_report_from_OD = pickle.loads(data_get_data_content.content)
                else:
                    yearly_report_from_OD = pickle.loads(data_get_data_content.content)


                if stock == 'F':
                    if check_item_name == 'yearly':
                        stock_output_combined_out = z_Func.get_stock_info_for_F(stock=stock, proxy_add=proxy_add)
                        stock_output_combined = stock_output_combined_out[0]
                        stock_name = stock_output_combined_out[1]

                        ### to update data, keep the info just get, and remove the outdated info from OD
                        temp_output = pd.merge(stock_output_combined, yearly_report_from_OD, left_index=True, right_index=True, suffixes=('', '_y'))
                        cols_to_drop = [col for col in temp_output.columns if col.endswith('_y')]
                        temp_output.drop(columns=cols_to_drop, inplace=True)

                        temp_output = temp_output.set_index(stock_output_combined.index)
                        stock_output_yearly= temp_output.sort_index(axis=1, ascending=False) # to merge data together.

                        ### to update the data in OneDrive as well....
                        z_Func.update_data_in_OneDrive(stock_name=stock_name, stock_data=stock_output_yearly, stock=stock, user_id=user_id, data_file_id=data_file_id, result=result, proxies=proxies)

                else:
                    if check_item_name == 'yearly':
                        latest_report_year = int(yearly_report_from_OD.columns[0][:4])
                        latest_report_notice_date = yearly_report_from_OD.loc['Notice Date'][0]
                    else:
                        latest_report_month = int(Seasonly_report_from_OD.columns[0][5:7])
                        latest_report_notice_date = Seasonly_report_from_OD.loc['Notice Date'][0]

                    latest_report_notice_date = datetime.datetime.strptime(latest_report_notice_date, '%Y-%m-%d').date()

                    ### check if data is updated...
                    today_year = day_one.year
                    today_month = day_one.month

                    if check_item_name == 'yearly':
                        if (day_one - latest_report_notice_date).days < 365:
                            # no need to call function to download data from East Money.
                            # since the latest report is saved in the file already.
                            print('~~~ The Yearly data stored in OneDrive is updated, Good !!! \n')
                            stock_output_yearly = yearly_report_from_OD
                            # url_yearly = z_Func.Year_report_url(stock=stock, stock_cn=stock_cn, p_income_year=p_income_year, p_cash_flow=p_cash_flow, p_balance_sheet=p_balance_sheet, day_one=day_one)
                            # yearly_report_raw_out = z_Func.report_from_East_Money(url=url_yearly, proxies=proxies, stock_cn=stock_cn)
                            # stock_name = yearly_report_raw_out[1] # for stock name
                        else:
                            print(':::: It\'s time to update the Yearly data now ...   ::::\n')
                            ### get the yearly report date ################################
                            url_yearly = z_Func.Year_report_url(stock=stock, stock_cn=stock_cn, p_income_year=p_income_year, p_cash_flow=p_cash_flow, p_balance_sheet=p_balance_sheet, day_one=day_one)
                            yearly_report_raw_out = z_Func.report_from_East_Money(url=url_yearly, proxies=proxies, stock_cn=stock_cn)
                            yearly_report_raw = yearly_report_raw_out[0]
                            stock_name = yearly_report_raw_out[1]

                            stock_output_yearly = yearly_report_raw

                            ### to update data, keep the info from East Mondy, and remove the outdated info from OD
                            temp_output = pd.merge(stock_output_yearly, yearly_report_from_OD, left_index=True, right_index=True, suffixes=('', '_y'))
                            cols_to_drop = [col for col in temp_output.columns if col.endswith('_y')]
                            temp_output.drop(columns=cols_to_drop, inplace=True)

                            temp_output = temp_output.set_index(stock_output_yearly.index)
                            stock_output_yearly= temp_output.sort_index(axis=1, ascending=False) # to merge data together.

                            ### here is some explaination for DataFame:
                            ### df_new = df.rename(columns={'2022-12-31':'2024-06-30'}) # for column rename

                            ### to update the data in OneDrive as well....
                            z_Func.update_data_in_OneDrive(stock_name=stock_name, stock_data=stock_output_yearly, stock=stock, user_id=user_id, data_file_id=data_file_id, result=result, proxies=proxies)
                            print(':::: It\'s Yearly data saved to OneDrive ...   ::::\n')
                    else:
                        if (day_one - latest_report_notice_date).days < 40:
                            # no need to call function to download data from East Money.
                            # since the latest report is saved in the file already.
                            print('~~~ The Seasonly data stored in OneDrive is updated, Good !!! \n')
                            stock_output_Seasonly = Seasonly_report_from_OD
                        else:
                            print(':::: It\'s time to update the Seasonly data now ...   ::::\n')
                            ### get the yearly report date ################################
                            try:
                                report_notification_date_yearly = stock_output_yearly.loc['Notice Date']

                                url_seasonly = z_Func.Seasonly_report_url(report_date_yearly=report_notification_date_yearly, stock=stock, stock_cn=stock_cn, p_income=p_income, p_cash_flow=p_cash_flow, p_balance_sheet=p_balance_sheet)
                                Seasonly_report_raw_out = z_Func.report_from_East_Money(url=url_seasonly, proxies=proxies, stock_cn=stock_cn)
                                Seasonly_report_raw = Seasonly_report_raw_out[0]
                                stock_name = Seasonly_report_raw_out[1]

                                stock_output_Seasonly = Seasonly_report_raw

                                ### to update data, keep the info from East Mondy, and remove the outdated info from OD
                                temp_output = pd.merge(stock_output_Seasonly, Seasonly_report_from_OD, left_index=True, right_index=True, suffixes=('', '_y'))
                                cols_to_drop = [col for col in temp_output.columns if col.endswith('_y')]
                                temp_output.drop(columns=cols_to_drop, inplace=True)

                                temp_output = temp_output.set_index(stock_output_Seasonly.index)
                                stock_output_Seasonly= temp_output.sort_index(axis=1, ascending=False) # to merge data together.

                                ### here is some explaination for DataFame:
                                ### df_new = df.rename(columns={'2022-12-31':'2024-06-30'}) # for column rename

                                ### to update the data in OneDrive as well....
                                z_Func.update_monthly_data_in_OneDrive(stock_name=stock_name, stock_data=stock_output_Seasonly, stock=stock, user_id=user_id, data_file_id=data_file_id, result=result, proxies=proxies)
                            except:
                                print('No seasonly report available as of now...\n')
                        pass
        ##### data does NOT exist ####
        if not found:
            print(f"'{stock_file_str}' was not found in saved files from OneDrive.\n") 

            if check_item_name == 'yearly':
                print('---------No Yearly data saved before, it\'s time to save it...---------\n')
            else:
                print('---------No Monthly data saved before, it\'s time to save it...---------\n')

            if stock == 'F':
                if check_item_name == 'yearly':
                    stock_output_combined_out = z_Func.get_stock_info_for_F(stock=stock, proxy_add=proxy_add)
                    stock_output_combined = stock_output_combined_out[0]
                    stock_name = stock_output_combined_out[1]

                    z_Func.save_data_to_OneDrive_newFile(stock_name=stock_name, stock_data=stock_output_combined, stock=stock, user_id=user_id, parent_id=parent_id, result=result, proxies=proxies)
                    stock_output_yearly = stock_output_combined

            else: # for other stocks from SH/SZ:
                if check_item_name == 'yearly':
                    ### get the yearly report date ################################
                    url_yearly = z_Func.Year_report_url(stock=stock, stock_cn=stock_cn, p_income_year=p_income_year, p_cash_flow=p_cash_flow, p_balance_sheet=p_balance_sheet, day_one=day_one)
                    yearly_report_raw_out = z_Func.report_from_East_Money(url=url_yearly, proxies=proxies, stock_cn=stock_cn)
                    yearly_report_raw = yearly_report_raw_out[0] # for dataframe info
                    stock_name = yearly_report_raw_out[1] # for stock name

                    stock_output_yearly = yearly_report_raw

                    # call save data function
                    z_Func.save_data_to_OneDrive_newFile(stock_name=stock_name, stock_data=stock_output_yearly, stock=stock, user_id=user_id, parent_id=parent_id, result=result, proxies=proxies)

                else:
                    ### get the monthly report date ################################
                    try: # if yearly report just released, no seasonly report...
                        report_notification_date_yearly = stock_output_yearly.loc['Notice Date']

                        url_seasonly = z_Func.Seasonly_report_url(report_date_yearly=report_notification_date_yearly, stock=stock, stock_cn=stock_cn, p_income=p_income, p_cash_flow=p_cash_flow, p_balance_sheet=p_balance_sheet)
                        Seasonly_report_raw_out = z_Func.report_from_East_Money(url=url_seasonly, proxies=proxies, stock_cn=stock_cn)
                        Seasonly_report_raw = Seasonly_report_raw_out[0] # for dataframe info
                        stock_name = Seasonly_report_raw_out[1] # for stock name

                        stock_output_Seasonly = Seasonly_report_raw

                        # call save data function
                        z_Func.save_monthly_data_to_OneDrive_newFile(stock_name=stock_name, stock_data=stock_output_Seasonly, stock=stock, user_id=user_id, parent_id=parent_id, result=result, proxies=proxies)
                    except:
                        print('No seasonly report available as of now...\n')

    
    ### to get the stock price range from yahoo finance #############################
    print('------- To get the Yearly stock price range from Yahoo Finance ------------\n')
    print('Please Note: the stock price for the latest period is just to as of now...\n')
    if stock != 'F':
        stock_price_yearly = z_Func.get_stock_price_range(stock_output=stock_output_yearly, stock=stock, day_one=day_one, proxy_add=proxy_add)
        stock_output_yearly_f = pd.concat([stock_output_yearly, stock_price_yearly], axis=0)

    try:
        print('------- To get the Seasonly stock price range from Yahoo Finance ------------\n')
        print('Please Note: the stock price for the latest period is just to as of now...\n')
        stock_price_Seasonly = z_Func.get_stock_price_range(stock_output=stock_output_Seasonly, stock=stock, day_one=day_one, proxy_add=proxy_add)

        ### to combine the stock price with the stock output #############################
        stock_output_Seasonly_f = pd.concat([stock_output_Seasonly, stock_price_Seasonly], axis=0)

        stock_output_combined = pd.concat([stock_output_Seasonly_f, stock_output_yearly_f], axis=1)
    except:
        stock_output_combined = pd.concat([stock_output_yearly_f], axis=1)
        print('No seasonly report available as of now...\n')


    stock_Top_temp.append('{}--{}-{}'.format(iii, stock, stock_name))


    ### to get the latest 10 days stock price #########################################
    last_7_days_stock_price_high_low = z_Func.get_latest_7_days_stock_price(stock=stock, proxy_add=proxy_add)
    print('---Got latest 10 days stock price from Yahoo Finance---------\n')

    ### Dividend Records of The Company ###
    stock_target = yf.Ticker(stock)
    stock_0_dividends = stock_target.get_dividends(proxy=proxy_add)


    ############## Checking Status ###################################

    ### to check the profit margin #########################################
    stock_0_profit_margin = stock_output_yearly.loc['稀释后 每年/季度每股收益 元']
    stock_0_profit_margin_increase = stock_output_yearly.loc['每股利润增长率 x 100%']

    if any(map(lambda x: x < 0, stock_0_profit_margin)):  # 查看利润是否有负数
        profit_margin_performance = 'xxxxxxxxx  利润 <0,  不是 一直在增长 xxxxxxx'
        stock_Top_temp.append('false')
    else:
        if any(map(lambda x: x < 0, stock_0_profit_margin_increase)):  # 查看利润同比去年是否有负增长
            profit_margin_performance = 'xxxxxxxxx  利润 下降  xxxxxxxxx'
            stock_Top_temp.append('false')
        else:
            profit_margin_performance = '√√√√√√√√√√  利润  Yes  最近几年一直在增长 √√√√'
            stock_Top_temp.append('true')


    ### to check the CurrentAssets vs Liabilities #########################
    stock_0_CurrentAssets_vs_Liabilities = stock_output_yearly.loc['流动资产/流动负债>2']

    if any(map(lambda x: x < 1.5, stock_0_CurrentAssets_vs_Liabilities)):  # 查看流动资产/流动负债是否 <1.5
        CurrentAssets_vs_Liabilities_performance = 'xxxxxxxxx 流动负债过高 xxxxxxxxx'
        stock_Top_temp.append('false')
    else:
        CurrentAssets_vs_Liabilities_performance = '√√√√√√√√√√  流动负债 不高 √√√√√√√√√√'
        stock_Top_temp.append('true')



    ### to check the stock dividend status #################################
    if len(stock_0_dividends) == 0:
        dividends_perofrmance = 'xxxxxxxxx  公司 无 分红记录  xxxxxxxxx'
        stock_Top_temp.append('false')
    elif len(stock_0_dividends) < 7:
        dividends_perofrmance = 'xxxxxxxxx  公司分红记录较少  xxxxxxxxx'
        stock_Top_temp.append('false')
    else:
        dividends_perofrmance = '√√√√√√√√√√  公司分红 很多次  √√√√√√√√√√ '
        stock_Top_temp.append('true')
    stock_Top_list.append(stock_Top_temp)  # 记录公司表现，利润，流动负债率，分红


    ############## Checking Status Completed ########################


    if (profit_margin_performance == 'xxxxxxxxx  利润 <0,  不是 一直在增长 xxxxxxx' and CurrentAssets_vs_Liabilities_performance == 'xxxxxxxxx 流动负债过高 xxxxxxxxx' and dividends_perofrmance == 'xxxxxxxxx  公司分红记录较少  xxxxxxxxx'):
        time.sleep(random.uniform(7, 13))
        continue

    else:
        page_content = "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name, profit_margin_performance)
        page_content += "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name, CurrentAssets_vs_Liabilities_performance)
        page_content += "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name, dividends_perofrmance)
        try:
            page_content += stock_output_combined.to_html()
        except NameError:
            # Handle the case where stock_output_combined is not defined
            pass
        page_content += "<div><p>This is the last 10 days stock price for {} {}: {}</p></div>".format(
            stock, stock_name, last_7_days_stock_price_high_low)
        if stock_0_dividends.empty:
            page_content += "<div><p>No dividend record for {}: {}</p></div>".format(
                stock, stock_name)
        else:
            if len(stock_0_dividends) < 15:
                page_content += stock_0_dividends.to_frame().to_html()
            else:
                page_content += stock_0_dividends[-13:].to_frame().to_html()

        page_content += "<div><p>                                                                                                </p></div>"
        page_content = page_content.replace('<th></th>', '<th>item</th>')

        # stock_output.to_excel('{}-Output.xlsx'.format(stock),header=1, index=1, encoding='utf_8_sig')
        print('{}--{}-{}'.format(iii, stock,
              stock_name), profit_margin_performance, '\n')
        print('{}--{}-{}'.format(iii, stock,
              stock_name), CurrentAssets_vs_Liabilities_performance, '\n')
        print('{}--{}-{}'.format(iii, stock,
              stock_name), dividends_perofrmance, '\n')
        print('This is the output for No. #{} ---{}: {} \n'.format(iii,
              stock, stock_name))
        try:
            print(tabulate(stock_output_combined, headers='keys', tablefmt='simple'))
        except:
            pass
        print('This is the last 10 days stock price for {} {}: {} \n'.format(
            stock, stock_name, last_7_days_stock_price_high_low))
        print(stock_0_dividends)
        print('--------Complete this one : ↑ ↑ ↑ ↑ ↑  ---------------------\n')
        print('                                                                                                \n')

        # #### Append OneNote page content ###
        # body_data_append = [
        #     {
        #         "target": "body",
        #         "action": "append",
        #         "content": page_content
        #     }
        # ]

        # try:
        #     data = requests.patch(
        #         endpoint, headers=http_headers, data=json.dumps(body_data_append, indent=4))
        # except:
        #     data = requests.patch(endpoint, headers=http_headers, data=json.dumps(
        #         body_data_append, indent=4), proxies=proxies)

        with open(f'{page_title}.html', "a", encoding="utf-8") as file:  # Open in append mode
            file.write(page_content)
        print(f'Data Added to File {page_title}.html successfully for OneNote page! \n')


# stock_Top_list = pd.DataFrame(stock_Top_list, columns=stock_Top_list_columns).sort_values(
#     by=['利润表现好', '流动负债不高', '分红多'], ascending=False)
# print(tabulate(stock_Top_list, headers='keys', tablefmt='simple',))
# page_content = stock_Top_list.to_html()
# page_content = page_content.replace('<th></th>', '<th>item</th>')


# # login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
# # result = login_return['result']

# # ### Create a OneNote Page for the summary ###
# # http_headers_create_page = {'Authorization': 'Bearer ' + result['access_token'],
# #               'Content-Type': 'application/xhtml+xml'}
# page_title_summary = 'Summary for {} Stock Info'.format(day_one.strftime('%Y-%m-%d'))

# create_0 = """
# <!DOCTYPE html>
# <html>
# <head>
# <title>{}</title>
# <meta name="created" content="{}" />
# </head>
# """.format(page_title,(datetime.datetime.now(datetime.timezone.utc)+ datetime.timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%S+08:00')).replace('\n','').strip()

# create_1 = """
# <body>
# {}
# </body>
# </html>
# """.format(page_content)

# create_page_initial = create_0 + create_1

# # try:
# #    data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial.encode('utf-8'))
# # except:
# #    data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial.encode('utf-8'),proxies=proxies)
# # if data.status_code == 201:
# #     print('Created OneNote page successfully! \n')

# with open(f'{page_title_summary}.html', "w", encoding="utf-8") as file:  # Open in append mode
#     file.write(create_page_initial)
# print(f'Summary Info Added to File {page_title_summary}.html successfully for OneNote page! \n')

html_files = [file for file in os.listdir('.') if file.endswith('.html')]
print("HTML files in the current directory:")
print(html_files)

for file in html_files:
    z_Func.Save_File_To_OneDrive(file=file, user_id=user_id, parent_id=parent_id, result=result, proxies=proxies)

print('Task Completed Successfully! \n')
