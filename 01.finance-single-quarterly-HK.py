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


# =====Basic Info from EasMon====#
p_cash_flow = 'CASHFLOW'
p_balance_sheet = 'BALANCE'
p_income = 'INCOMEQC'
p_income_year = 'INCOME'

# config.read(['config1.cfg'])
# stock_settings = config['stock_name']
# stock = stock_settings['stock_name']


######## Below is the Main Function #################################

login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value info
result = login_return['result']
proxies = login_return['proxies']
finance_section_id = login_return['finance_section_id']
token_start_time = datetime.datetime.now()
site__id_personal_z = login_return['site__id_personal_z']
site__id_cmmas = login_return['site__id_cmmas']

# to get the list id and relative info:
# visit Microsoft Graph API Reference Document https://learn.microsoft.com/en-us/graph/api/site-get?view=graph-rest-1.0 for more information.
# if  list_url = 'https://xxx-my.sharepoint.com/personal/xxx_yyy_onmicrosoft_com/Lists/Learning_records/AllItems.aspx'
# then  endpoint_for_site__id_personal_z = 'https://graph.microsoft.com/v1.0/sites/xxx-my.sharepoint.com:/personal/xxx_yyy_onmicrosoft_com/'
# data = requests.get(endpoint_for_site__id_personal_z, headers=http_headers, stream=False).json()
# site__id_personal_z = data['id'].split(',')[1]

# to get the list item info, which is needed for creating new lists item
endpoint = "https://graph.microsoft.com/v1.0/sites/{}/lists/Stock_For_GitHub/items?$expand=fields($select=Title,teamId,ChannelId,replyToMessageId)".format(
    site__id_personal_z)
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
endpoint = "https://graph.microsoft.com/v1.0/sites/{}/lists".format(site__id_personal_z)
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
    site__id_personal_z, list_id, item_id)
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

    with open(f'{page_title}.html', "a", encoding='utf-8') as file:
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
    elif stock_code[iii][0] == 'H':
        stock = stock_code[iii][1:] + '.HK'  # SH stock
        stock_cn = stock_code[iii][1:] + '.HK'  # SH stock
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


    #TODO  to get the fild content for Notification Date:
    for item in saved_files_list_lite.keys():
        if stock_code[iii] in item:
            data_file_id = saved_files_list_lite[item]
    endpoint_data_file_content = 'https://graph.microsoft.com/v1.0/users/' + '/{}/drive/items/{}/content'.format(user_id, data_file_id)
    try:
        data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False)
    except:
        data_get_data_content = requests.get(endpoint_data_file_content, headers=http_headers, stream=False, proxies=proxies)
    
    from io import BytesIO
    file_content = data_get_data_content.content
    df = pd.read_excel(BytesIO(file_content), engine="openpyxl")
    notification_date_df = df
    notification_date_series = df['Notice_Date']
    notification_date_list = notification_date_series.dt.strftime('%Y-%m-%d').tolist()

    print('-----Stock No.{}---Begin of {}: ↓ ↓ ↓ ↓ ↓  ---------------\n'.format(iii, stock))

    ### to get the yearly report from the Eas Mon ################################
    print('------- To Get the [- yearly -] report from DataBase ------------\n')
    

    ### to check if the data is stored in OneDrive, if not, then save it, if yes, then check if it's updated or not.
    ### check OneDrive stored date ###
    ### GET /users/{user-id}/drive/root:/{item-path}
    ### if file not exist, create a new one ###
    ###     call get report from Eas Mon, and save it.
    ###     PUT /users/{user-id}/drive/items/{parent-id}:/{filename}:/content
    ### if file exist, compare the latest report date and today-1.
    ###     get file content: GET /users/{userId}/drive/items/{item-id}/content
    ###     if same, then just read it.
    ###     if not same, then call get report from Eas Mon, and combine it with exist date, and save it.
    ###     PUT /users/{user-id}/drive/items/{item-id}/content


    check_item = ['yearly']

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
        if not found:
            print(f"'{stock_file_str}' was not found .\n") 

            if check_item_name == 'yearly':
                print('-----------------\n')

            if stock == 'F':
                pass
            else: # for other stocks from HK:
                if check_item_name == 'yearly':
                    ### get the yearly report date ################################
                    url_yearly = z_Func.Year_report_url_HK(stock_hk=stock_cn, day_one=day_one)
                    yearly_report_raw_out = z_Func.report_from_Eas_Mon_HK(url=url_yearly, proxies=proxies, stock_hk=stock_cn)
                    yearly_report_raw = yearly_report_raw_out[0] # for dataframe info
                    notification_date_df = pd.DataFrame(notification_date_list, index=yearly_report_raw.columns, columns=['Notice Date']).T
                    yearly_report_raw = pd.concat([notification_date_df, yearly_report_raw], axis=0)
                    stock_name = yearly_report_raw_out[1] # for stock name

                    stock_output_yearly = yearly_report_raw
    
        stock_output_yearly_f = pd.concat([stock_output_yearly], axis=0)

        try:
            stock_output_combined = pd.concat([stock_output_yearly_f], axis=1)
        except:
            stock_output_combined = pd.concat([stock_output_yearly_f], axis=1)


    stock_Top_temp.append('{}--{}-{}'.format(iii, stock, stock_name))

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
    stock_Top_list.append(stock_Top_temp)  # 记录公司表现，利润，流动负债率，分红

    ############## Checking Status Completed ########################


    if (profit_margin_performance == 'xxxxxxxxx  利润 <0,  不是 一直在增长 xxxxxxx' and CurrentAssets_vs_Liabilities_performance == 'xxxxxxxxx 流动负债过高 xxxxxxxxx'):
        time.sleep(random.uniform(7, 13))
        continue

    else:
        page_content = "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name, profit_margin_performance)
        page_content += "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name, CurrentAssets_vs_Liabilities_performance)
        try:
            page_content += stock_output_combined.to_html()
        except NameError:
            # Handle the case where stock_output_combined is not defined
            pass

        page_content += "<div><p>                                                                                                </p></div>"
        page_content = page_content.replace('<th></th>', '<th>item</th>')

        # stock_output.to_excel('{}-Output.xlsx'.format(stock),header=1, index=1, encoding='utf_8_sig')
        print('{}--{}-{}'.format(iii, stock,
              stock_name), profit_margin_performance, '\n')
        print('{}--{}-{}'.format(iii, stock,
              stock_name), CurrentAssets_vs_Liabilities_performance, '\n')
        print('This is the output for No. #{} ---{}: {} \n'.format(iii,
              stock, stock_name))
        try:
            print(tabulate(stock_output_combined, headers='keys', tablefmt='simple'))
        except:
            pass
        print('--------Complete this one : ↑ ↑ ↑ ↑ ↑  ---------------------\n')
        print('                                                                                                \n')


        with open(f'{page_title}.html', "a", encoding="utf-8") as file:  # Open in append mode
            file.write(page_content)
        print(f'Data Added to File {page_title}.html successfully for OneNote page! \n')

html_files = [file for file in os.listdir('.') if file.endswith('.html')]
print("HTML files in the current directory:")
print(html_files)

for file in html_files:
    z_Func.Save_File_To_OneDrive(file=file, user_id=user_id, parent_id=parent_id, result=result, proxies=proxies)

print('Task Completed Successfully! \n')
