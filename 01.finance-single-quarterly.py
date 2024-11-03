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

# https://data.eastmoney.com/other/index/hs300.html 沪深300成分股清单

config = configparser.ConfigParser()
# to check if local file config.cfg is available, for local running application
if os.path.exists('./config.cfg'):
    config.read(['config.cfg'])
    proxy_settings = config['proxy_add']
    if os.getlogin() == 'cindy.rao':
        proxy_add = None
    else:
        proxy_add = proxy_settings['proxy_add']
else:
    proxy_add = None

# to login into MS365 and get the return value
login_return = funcLG.func_login_secret()
result = login_return['result']
proxies = login_return['proxies']
finance_section_id = login_return['finance_section_id']
site_id = login_return['site_id']

# config.read(['config1.cfg'])
# stock_settings = config['stock_name']
# stock = stock_settings['stock_name']

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
stock_code = data.json()['value'][0]['fields']['Title'].replace(' ', '')
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

stock_Top_list = []
stock_Top_list_columns = ['Stock Number', '利润表现好', '流动负债不高', '分红多']

day_one = datetime.date.today()

# the endpoint shall not use /me, shall be updated here.
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

### Create a OneNote Page ###
# endpoint_create_page = 'https://graph.microsoft.com/v1.0/me/onenote/sections/{}/pages'.format(finance_section_id)
endpoint_create_page = 'https://graph.microsoft.com/v1.0/users/{}/onenote/sections/{}/pages'.format(
    user_id, finance_section_id)
http_headers_create_page = {'Authorization': 'Bearer ' + result['access_token'],
                            'Content-Type': 'application/xhtml+xml'}
page_title = '{}-Stock info {}-quarterly'.format(
    stock_code, day_one.strftime('%Y-%m-%d'))
create_page_initial = """
<!DOCTYPE html>
<html>
<head>
<title>{}</title>
<meta name="created" content="{}" />
</head>
<body>
<!-- No content in the body -->
</body>
</html>
""".format(page_title, (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%S+08:00')).replace('\n', '').strip()
try:
    data = requests.post(
        endpoint_create_page, headers=http_headers_create_page, data=create_page_initial)
except:
    data = requests.post(endpoint_create_page, headers=http_headers_create_page,
                         data=create_page_initial, proxies=proxies)
if data.status_code == 201:
    onenote_page_url = data.json()['links']['oneNoteWebUrl']['href']


#### Append OneNote page content ###
#### Only endpoint is defined here, detailed info for Append is listed down below after the data processing ###
# this is the id for OneNote page created above.
onenote_page_id = data.json()['id']
# endpoint = 'https://graph.microsoft.com/v1.0/me/onenote/pages/{}/content'.format(onenote_page_id)
endpoint = 'https://graph.microsoft.com/v1.0/users/{}/onenote/pages/{}/content'.format(
    user_id, onenote_page_id)
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Content-Type': 'application/json'}

# below is to change the title of this page
page_title_value = [{
    'target': 'title',
    'action': 'replace',
    'content': 'Python Test for OneNote API'
}]


if stock_code:  # 在所有的沪深300成分股里面进行查询
    stock_Top_temp = []
    if stock_code == 'F':
        stock = 'F'
        stock_name = 'Ford'
    else:
        if len(str(stock_code)) == 6:
            if str(stock_code)[0] == '6':  # SH stock
                stock = str(stock_code) + '.ss'  # SH stock
                stock_cn = str(stock_code) + '.SH'  # SH stock
            else:
                stock = str(stock_code) + '.sz'  # SZ stock
                stock_cn = str(stock_code) + '.SZ'  # SZ stock
        else:
            len_temp = 6 - len(str(stock_code))
            prefix = ''
            for ii in range(0, len_temp):
                prefix = prefix + '0'
            stock = prefix + str(stock_code) + '.sz'  # SZ stock
            stock_cn = prefix + str(stock_code) + '.SZ'  # SZ stock
        stock_name = 'TBD'

    ### 以下是对一只股票进行查询 ###
    stock_target = yf.Ticker(stock)
    stock_target_sales = stock_target.get_cashflow(
        freq='yearly', proxy=proxy_add)
    stock_target_balance_sheet = stock_target.get_balance_sheet(
        freq='yearly', proxy=proxy_add)
    stock_target_income = stock_target.get_income_stmt(
        freq='yearly', proxy=proxy_add)

    if 'EBIT' in stock_target_income.index and 'CurrentAssets' in stock_target_balance_sheet.index and 'TotalRevenue' in stock_target_income.index and 'TotalAssets' in stock_target_balance_sheet.index and 'CurrentLiabilities' in stock_target_balance_sheet.index and 'TotalNonCurrentLiabilitiesNetMinorityInterest' in stock_target_balance_sheet.index and 'DilutedEPS' in stock_target_income.index and 'OtherIntangibleAssets' in stock_target_balance_sheet.index and 'TotalLiabilitiesNetMinorityInterest' in stock_target_balance_sheet.index and 'OrdinarySharesNumber' in stock_target_balance_sheet.index:
        print('--------Begin of {}: ↓ ↓ ↓ ↓ ↓  ---------------------\n'.format(stock))

        ### How Big The Company Is ###
        # 销售额
        stock_0_TotalRevenue = stock_target_income.loc['TotalRevenue']/100000000
        stock_0_TotalRevenue.name = '营业总收入 销售额 亿元'
        stock_0_TotalRevenue.index = stock_0_TotalRevenue.index.strftime(
            '%Y-%m-%d')

        # 总资产
        stock_0_TotalAssets = stock_target_balance_sheet.loc['TotalAssets']/100000000
        stock_0_TotalAssets.name = '总资产 亿元'
        stock_0_TotalAssets.index = stock_0_TotalAssets.index.strftime(
            '%Y-%m-%d')

        stock_0_EBIT = stock_target_income.loc['EBIT']/100000000  # 息税前利润
        stock_0_EBIT.index = stock_0_EBIT.index.strftime('%Y-%m-%d')
        stock_0_EBIT.name = '营业收入 息税前利润 亿元'

        ### Profit Stability of The Company ###
        # 每股稀释后收益，每股收益
        stock_0_profit_margin = stock_target_income.loc['DilutedEPS']
        stock_0_profit_margin.name = '稀释后 每季度每股收益 元'
        stock_0_profit_margin.index = stock_0_profit_margin.index.strftime(
            '%Y-%m-%d')

        stock_0_profit_margin_increase = []
        for ix in range(0, len(stock_0_profit_margin)-1):
            margin_increase = round(
                (stock_0_profit_margin.values[ix] - stock_0_profit_margin.values[ix+1])/stock_0_profit_margin.values[ix+1], 2)
            stock_0_profit_margin_increase.append(margin_increase)
        stock_0_profit_margin_increase.append(1)  # 最后一年作为基数1
        stock_0_profit_margin_increase_list = stock_0_profit_margin_increase

        stock_0_profit_margin_increase = pd.DataFrame(
            stock_0_profit_margin_increase).set_index(stock_0_profit_margin.index)
        stock_0_profit_margin_increase = stock_0_profit_margin_increase.T.set_index([
                                                                                    ['每股利润增长率 x 100%']])
        stock_0_profit_margin_increase = stock_0_profit_margin_increase.T

        ### How Well The Company Financial Status is ###
        # 流动资产
        stock_0_CurrentAssets = stock_target_balance_sheet.loc['CurrentAssets']/100000000
        stock_0_CurrentAssets.name = '流动资产 亿元'
        stock_0_CurrentAssets.index = stock_0_CurrentAssets.index.strftime(
            '%Y-%m-%d')

        # 流动负债
        stock_0_CurrentLiabilities = stock_target_balance_sheet.loc['CurrentLiabilities']/100000000
        stock_0_CurrentLiabilities.name = '流动负债 亿元'
        stock_0_CurrentLiabilities.index = stock_0_CurrentLiabilities.index.strftime(
            '%Y-%m-%d')

        stock_0_CurrentAssets_vs_Liabilities = stock_target_balance_sheet.loc[
            'CurrentAssets']/stock_target_balance_sheet.loc['CurrentLiabilities']  # 流动资产与流动负债之比 应>2
        stock_0_CurrentAssets_vs_Liabilities.name = '流动资产/流动负债>2'
        stock_0_CurrentAssets_vs_Liabilities.index = stock_0_CurrentAssets_vs_Liabilities.index.strftime(
            '%Y-%m-%d')

        stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest = stock_target_balance_sheet.loc[
            'TotalNonCurrentLiabilitiesNetMinorityInterest']/100000000  # 非流动负债合计，我认为是长期负债
        stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest.name = '非流动负债'
        stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest.index = stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest.index.strftime(
            '%Y-%m-%d')

        stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities = stock_0_CurrentAssets - \
            stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest  # 流动资产扣除长期负债后应大于0
        stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities.name = '流动资产-长期负债>0'

        ### Dividend Records of The Company ###
        stock_0_dividends = stock_target.get_dividends(proxy=proxy_add)

        ### PE Ratio of the Company ###
        stock_PE_ratio_target = 15  # 这个是目标市盈率，股份不超过这个可以考虑入手
        stock_price_less_than_PE_ratio = stock_PE_ratio_target * \
            stock_0_profit_margin  # 股份不能超过的值
        stock_price_less_than_PE_ratio.name = '市盈率15对应股价 元'

        ### Stock price vs Assets ratio ###
        # 无形资产
        stock_0_OtherIntangibleAssets = stock_target_balance_sheet.loc[
            'OtherIntangibleAssets']/100000000
        stock_0_OtherIntangibleAssets.index = stock_0_OtherIntangibleAssets.index.strftime(
            '%Y-%m-%d')

        # 总负债
        stock_0_TotalLiabilitiesNetMinorityInterest = stock_target_balance_sheet.loc[
            'TotalLiabilitiesNetMinorityInterest']/100000000
        stock_0_TotalLiabilitiesNetMinorityInterest.index = stock_0_TotalLiabilitiesNetMinorityInterest.index.strftime(
            '%Y-%m-%d')

        # 普通股数量
        stock_0_OrdinarySharesNumber = stock_target_balance_sheet.loc[
            'OrdinarySharesNumber']/1000000
        stock_0_OrdinarySharesNumber.name = '普通股数量 百万'
        stock_0_OrdinarySharesNumber.index = stock_0_OrdinarySharesNumber.index.strftime(
            '%Y-%m-%d')

        stock_0_BookValue = stock_0_TotalAssets - stock_0_OtherIntangibleAssets - \
            stock_0_TotalLiabilitiesNetMinorityInterest  # 总账面价值
        stock_0_BookValue_per_Share = stock_0_BookValue*100000000 / \
            (stock_0_OrdinarySharesNumber*1000000)  # 每股账面价值
        stock_0_BookValue_per_Share.name = '每股账面价值 元'
        stock_price_less_than_BookValue_ratio = stock_0_BookValue_per_Share*1.5  # 按账面价值计算出来的目标股价
        stock_price_less_than_BookValue_ratio.name = '每股账面价值1.5倍元'

        stock_Top_temp.append('{}--{}-{}'.format(0, stock, stock_name))

        if any(map(lambda x: x < 0, stock_0_profit_margin)):  # 查看利润是否有负数
            profit_margin_performance = 'xxxxxxxxx  利润 <0,  不是 一直在增长 xxxxxxx'
            stock_Top_temp.append('false')
        else:
            if any(map(lambda x: x < 0, stock_0_profit_margin_increase_list)):  # 查看利润同比去年是否有负增长
                profit_margin_performance = 'xxxxxxxxx  利润 下降  xxxxxxxxx'
                stock_Top_temp.append('false')
            else:
                profit_margin_performance = '√√√√√√√√√√  利润  Yes  最近几年一直在增长 √√√√'
                stock_Top_temp.append('true')

        if any(map(lambda x: x < 1.5, stock_0_CurrentAssets_vs_Liabilities)):  # 查看流动资产/流动负债是否 <1.5
            CurrentAssets_vs_Liabilities_performance = 'xxxxxxxxx 流动负债过高 xxxxxxxxx'
            stock_Top_temp.append('false')
        else:
            CurrentAssets_vs_Liabilities_performance = '√√√√√√√√√√  流动负债 不高 √√√√√√√√√√'
            stock_Top_temp.append('true')

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

        # =====To Get This Year Monthly Info from EastMoney====#
        p_cash_flow = 'CASHFLOW'
        p_balance_sheet = 'BALANCE'
        p_income = 'INCOMEQC'

        headers_eastmoney = {
            'Host': 'datacenter.eastmoney.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.7,zh-CN;q=0.3',
            'Origin': 'https://emweb.securities.eastmoney.com',
            'DNT': '1',
            'Referer': 'https://emweb.securities.eastmoney.com/',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site',
        }

        # for CN stock: to be updated later
        if (stock[7:] == 'ss' or stock[7:] == 'sz') and (len(stock) == 9):
            url_eastmoney_income = 'https://datacenter.eastmoney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v=06630889710346992'.format(
                p_income, p_income, stock_cn, day_one.year, day_one.year, day_one.year)

            url_eastmoney_cash_flow = 'https://datacenter.eastmoney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v=07479680066598243'.format(
                p_cash_flow, p_cash_flow, stock_cn, day_one.year, day_one.year, day_one.year)

            url_eastmoney_balance_sheet = 'https://datacenter.eastmoney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=F10_FINANCE_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v=035376456081999563'.format(
                p_balance_sheet, p_balance_sheet, stock_cn, day_one.year, day_one.year, day_one.year)

            try:
                response_income = requests.get(
                    url_eastmoney_income, headers=headers_eastmoney)
            except:
                response_income = requests.get(
                    url_eastmoney_income, headers=headers_eastmoney, proxies=proxies)
            if response_income.status_code == 200:
                # Process the response data here
                print('Got the response from East Money for {}.\n'.format(stock_cn))
                pass
            else:
                print(
                    f"Failed to retrieve data: {response_income.status_code}")
            time.sleep(random.uniform(20, 40))

            try:
                response_cash_flow = requests.get(
                    url_eastmoney_cash_flow, headers=headers_eastmoney)
            except:
                response_cash_flow = requests.get(
                    url_eastmoney_cash_flow, headers=headers_eastmoney, proxies=proxies)
            if response_cash_flow.status_code == 200:
                # Process the response data here
                # print(response_cash_flow.json())
                pass
            else:
                print(
                    f"Failed to retrieve data: {response_cash_flow.status_code}")
            time.sleep(random.uniform(20, 40))

            try:
                response_balance_sheet = requests.get(
                    url_eastmoney_balance_sheet, headers=headers_eastmoney)
            except:
                response_balance_sheet = requests.get(
                    url_eastmoney_balance_sheet, headers=headers_eastmoney, proxies=proxies)
            if response_balance_sheet.status_code == 200:
                # Process the response data here
                # print(response_balance_sheet.json())
                pass
            else:
                print(
                    f"Failed to retrieve data: {response_balance_sheet.status_code}")
            time.sleep(random.uniform(20, 40))

            try:
                df_income_stock = df(response_income.json()['result']['data'])
                df_cash_flow = df(response_cash_flow.json()['result']['data'])
                df_balance_sheet = df(
                    response_balance_sheet.json()['result']['data'])

                df_income_stock = df_income_stock.set_index('REPORT_DATE_NAME')
                df_cash_flow = df_cash_flow.set_index('REPORT_DATE_NAME')
                df_balance_sheet = df_balance_sheet.set_index(
                    'REPORT_DATE_NAME')

                stock_name = df_income_stock['SECURITY_NAME_ABBR'][0]

                quarter_mapping_income = {
                    '一季度': '-03-31',
                    '二季度': '-06-30',
                    '三季度': '-09-30',
                }
                new_index_income = df_income_stock.index.to_series().replace(
                    quarter_mapping_income, regex=True)
                df_income_stock = df_income_stock.set_index(
                    pd.Index(new_index_income, name='REPORT_DATE_NAME'))

                quarter_mapping_cash_flow = {
                    '一季报': '-03-31',
                    '中报': '-06-30',
                    '三季报': '-09-30',
                }
                new_index_cash_flow = df_cash_flow.index.to_series().replace(
                    quarter_mapping_cash_flow, regex=True)
                df_cash_flow = df_cash_flow.set_index(
                    pd.Index(new_index_cash_flow, name='REPORT_DATE_NAME'))
                df_balance_sheet = df_balance_sheet.set_index(
                    pd.Index(new_index_cash_flow, name='REPORT_DATE_NAME'))

                ### How Big The Company Is ###
                # 销售额
                stock_0_TotalRevenue_m = df_income_stock['TOTAL_OPERATE_INCOME']/100000000
                stock_0_TotalRevenue_m.name = '营业总收入 销售额 亿元'
                # 总资产
                stock_0_TotalAssets_m = df_balance_sheet['TOTAL_ASSETS']/100000000
                stock_0_TotalAssets_m.name = '总资产 亿元'
                # 息税前利润
                stock_0_EBIT_m = df_income_stock['OPERATE_PROFIT']/100000000
                stock_0_EBIT_m.name = '营业收入 息税前利润 亿元'

                ### Profit Stability of The Company ###
                # 每股稀释后收益 季度，每股收益
                stock_0_profit_margin_m = df_income_stock['DILUTED_EPS']
                stock_0_profit_margin_m.name = '稀释后 每季度每股收益 元'

                ### How Well The Company Financial Status is ###
                # 流动资产
                stock_0_CurrentAssets_m = df_balance_sheet['TOTAL_CURRENT_ASSETS']/100000000
                stock_0_CurrentAssets_m.name = '流动资产 亿元'
                # 流动负债
                stock_0_CurrentLiabilities_m = df_balance_sheet['TOTAL_CURRENT_LIAB']/100000000
                stock_0_CurrentLiabilities_m.name = '流动负债 亿元'
                # 流动资产与流动负债之比 应>2
                stock_0_CurrentAssets_vs_Liabilities_m = df_balance_sheet[
                    'TOTAL_CURRENT_ASSETS']/df_balance_sheet['TOTAL_CURRENT_LIAB']
                stock_0_CurrentAssets_vs_Liabilities_m.name = '流动资产/流动负债>2'
                # 非流动负债合计，我认为是长期负债
                stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_m = df_balance_sheet[
                    'TOTAL_NONCURRENT_LIAB']/100000000
                stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_m.name = '非流动负债'
                stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_m = stock_0_CurrentAssets_m - \
                    stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_m  # 流动资产扣除长期负债后应大于0
                stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_m.name = '流动资产-长期负债>0'

                ### Stock price vs Assets ratio ###
                # 无形资产
                stock_0_OtherIntangibleAssets_m = df_balance_sheet['INTANGIBLE_ASSET']/100000000
                # 总负债
                stock_0_TotalLiabilitiesNetMinorityInterest_m = df_balance_sheet[
                    'TOTAL_LIABILITIES']/100000000
                # 普通股数量
                stock_0_OrdinarySharesNumber_m = df_balance_sheet['SHARE_CAPITAL']/1000000
                stock_0_OrdinarySharesNumber_m.name = '普通股数量 百万'
                stock_0_BookValue_m = stock_0_TotalAssets_m - stock_0_OtherIntangibleAssets_m - \
                    stock_0_TotalLiabilitiesNetMinorityInterest_m  # 总账面价值
                stock_0_BookValue_per_Share_m = stock_0_BookValue_m * \
                    100000000/(stock_0_OrdinarySharesNumber_m *
                               1000000)  # 每股账面价值
                stock_0_BookValue_per_Share_m.name = '每股账面价值 元'
                stock_price_less_than_BookValue_ratio_m = stock_0_BookValue_per_Share_m * \
                    1.5  # 按账面价值计算出来的目标股价
                stock_price_less_than_BookValue_ratio_m.name = '每股账面价值1.5倍元'

                ### PE Ratio of the Company ###
                stock_PE_ratio_target = 15  # 这个是目标市盈率，股份不超过这个可以考虑入手
                stock_price_less_than_PE_ratio_m = stock_PE_ratio_target * \
                    stock_0_profit_margin_m * 4  # 股份不能超过的值
                stock_price_less_than_PE_ratio_m.name = '市盈率15对应股价 元'

                # # df_income_stock.T.to_excel('00.in.xlsx',encoding='utf-8')
                # # df_cash_flow.T.to_excel('00.ca.xlsx',encoding='utf-8')
                # df_balance_sheet.T.to_excel('00.ba.xlsx',encoding='utf-8')

                # ===============Monthly Info End=====================#

                stock_0_TotalRevenue = pd.concat(
                    [stock_0_TotalRevenue_m, stock_0_TotalRevenue])
                stock_0_TotalAssets = pd.concat(
                    [stock_0_TotalAssets_m, stock_0_TotalAssets])
                stock_0_EBIT = pd.concat([stock_0_EBIT_m, stock_0_EBIT])
                stock_0_CurrentAssets = pd.concat(
                    [stock_0_CurrentAssets_m, stock_0_CurrentAssets])
                stock_0_CurrentLiabilities = pd.concat(
                    [stock_0_CurrentLiabilities_m, stock_0_CurrentLiabilities])
                stock_0_CurrentAssets_vs_Liabilities = pd.concat(
                    [stock_0_CurrentAssets_vs_Liabilities_m, stock_0_CurrentAssets_vs_Liabilities])
                stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest = pd.concat(
                    [stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_m, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest])
                stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities = pd.concat(
                    [stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_m, stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities])
                stock_0_OrdinarySharesNumber = pd.concat(
                    [stock_0_OrdinarySharesNumber_m, stock_0_OrdinarySharesNumber])
                stock_0_profit_margin = pd.concat(
                    [stock_0_profit_margin_m, stock_0_profit_margin])
                stock_0_BookValue_per_Share = pd.concat(
                    [stock_0_BookValue_per_Share_m, stock_0_BookValue_per_Share])
                stock_price_less_than_BookValue_ratio = pd.concat(
                    [stock_price_less_than_BookValue_ratio_m, stock_price_less_than_BookValue_ratio])
                stock_price_less_than_PE_ratio = pd.concat(
                    [stock_price_less_than_PE_ratio_m, stock_price_less_than_PE_ratio])
                # to combine monthly data with yearly data, for CN stock
            except:
                print('Data is not available for {} in EasyMoney.\n'.format(stock_cn))

        stock_output = pd.concat([stock_0_TotalRevenue, stock_0_TotalAssets, stock_0_EBIT, stock_0_CurrentAssets, stock_0_CurrentLiabilities, stock_0_CurrentAssets_vs_Liabilities, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest,
                                 stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities, stock_0_OrdinarySharesNumber, stock_0_profit_margin, stock_0_profit_margin_increase, stock_0_BookValue_per_Share, stock_price_less_than_BookValue_ratio, stock_price_less_than_PE_ratio], axis=1)
        stock_output = stock_output.T.astype('float64').round(2)

        ### To get the stock price for each year ###
        duration = stock_output.columns
        stock_price_temp = []

        time_list = []
        for i in range(0, len(duration)):
            time_list.append(duration[i].split('-')[0])
        for i in range(0, len(time_list)):
            if int(time_list[i]) != day_one.year:
                stock_price = stock_target.history(start=str(int(
                    time_list[i])+1) + '-03-15', end=str(int(time_list[i])+2) + '-03-14', proxy=proxy_add)
            else:
                stock_price = stock_target.history(start=str(int(
                    time_list[i])) + '-03-15', end=str(int(time_list[i])+1) + '-03-14', proxy=proxy_add)

            if stock_price.empty:
                stock_price_high_low = 'None'
                stock_price_temp.append(stock_price_high_low)
            else:
                stock_price_high_low = '{:.2f}'.format(
                    stock_price['High'].min()) + '-' + '{:.2f}'.format(stock_price['High'].max())
                # stock_price_high_low = str(int(stock_price['High'].min())) + '-' + str(int(stock_price['High'].max()))
                stock_price_temp.append(stock_price_high_low)
        stock_price_output = pd.DataFrame([stock_price_temp])
        stock_price_output.columns = duration

        stock_price_output = stock_price_output.rename(index={0: '后一年股价范围'})
        stock_output = pd.concat([stock_output, stock_price_output], axis=0)

        last_7_days_end = datetime.datetime.now().strftime('%Y-%m-%d')
        last_7_days_start = (datetime.datetime.now() -
                             datetime.timedelta(days=7)).strftime('%Y-%m-%d')
        last_7_days_stock_price = stock_target.history(
            start=last_7_days_start, end=last_7_days_end, proxy=proxy_add)
        if last_7_days_stock_price.empty:
            last_7_days_stock_price_high_low = 'None'
        else:
            last_7_days_stock_price_high_low = '{:.2f}'.format(last_7_days_stock_price['High'].min(
            )) + '-' + '{:.2f}'.format(last_7_days_stock_price['High'].max())
            # last_7_days_stock_price_high_low = str(int(last_7_days_stock_price['High'].min())) + '-' + str(int(last_7_days_stock_price['High'].max()))

        page_content = "<div><p>{}--{}-{}, {}</p></div>".format(
            0, stock, stock_name, profit_margin_performance)
        page_content += "<div><p>{}--{}-{}, {}</p></div>".format(
            0, stock, stock_name, CurrentAssets_vs_Liabilities_performance)
        page_content += "<div><p>{}--{}-{}, {}</p></div>".format(
            0, stock, stock_name, dividends_perofrmance)
        # page_content += "<div><p>This is the output for No. #{} ---{}: {}</p></div>".format(0, stock, stock_name,)
        page_content += stock_output.to_html()
        page_content += "<div><p>This is the last 7 days stock price for {} {}: {}</p></div>".format(
            stock, stock_name, last_7_days_stock_price_high_low)
        # page_content += "<div><p>This is the dividend for {}: {}</p></div>".format(
        # stock, stock_name)
        if stock_0_dividends.empty:
            page_content += "<div><p>No dividend record for {}: {}</p></div>".format(
                stock, stock_name)
        else:
            if len(stock_0_dividends) < 8:
                page_content += stock_0_dividends.to_frame().to_html()
            else:
                page_content += stock_0_dividends[-6:].to_frame().to_html()

        # page_content += "<div><p>{}--{}-{}, {}</p></div>".format(0, stock, stock_name,dividends_perofrmance)
        # page_content += "<div><p>--------Complete this one : ↑ ↑ ↑ ↑ ↑  ---------------------</p></div>"
        page_content += "<div><p>                                                                                                </p></div>"
        # page_content = page_content.replace('\n','')
        page_content = page_content.replace('<th></th>', '<th>item</th>')

        # stock_output.to_excel('{}-Output.xlsx'.format(stock),header=1, index=1, encoding='utf_8_sig')
        print('{}--{}-{}'.format(0, stock,
              stock_name), profit_margin_performance, '\n')
        print('{}--{}-{}'.format(0, stock,
              stock_name), CurrentAssets_vs_Liabilities_performance, '\n')
        print('{}--{}-{}'.format(0, stock,
              stock_name), dividends_perofrmance, '\n')
        print('This is the output for No. #{} ---{}: {} \n'.format(0,
              stock, stock_name))
        print(tabulate(stock_output, headers='keys', tablefmt='simple'))
        print('This is the last 7 days stock price for {} {}: {} \n'.format(
            stock, stock_name, last_7_days_stock_price_high_low))
        # print('This is the dividend for {}: {} \n'.format(stock, stock_name))
        print(stock_0_dividends)
        print('--------Complete this one : ↑ ↑ ↑ ↑ ↑  ---------------------\n')
        print('                                                                                                \n')

        if (profit_margin_performance == 'xxxxxxxxx  利润 <0,  不是 一直在增长 xxxxxxx' and CurrentAssets_vs_Liabilities_performance == 'xxxxxxxxx 流动负债过高 xxxxxxxxx' and dividends_perofrmance == 'xxxxxxxxx  公司分红记录较少  xxxxxxxxx'):
            print(
                '----------------------- This Stock is not a good target ------------------------\n')
        else:
            pass
        #### Append OneNote page content ###
        body_data_append = [
            {
                "target": "body",
                "action": "append",
                "content": page_content
            }
        ]

        try:
            data = requests.patch(
                endpoint, headers=http_headers, data=json.dumps(body_data_append, indent=4))
        except:
            data = requests.patch(endpoint, headers=http_headers, data=json.dumps(
                body_data_append, indent=4), proxies=proxies)
        if data.status_code == 204:
            print('Data added to OneNote Successfully!\n')

            # to reply to MS Teams channel message, so you'll be informed.
            reply_message = {
                "body": {
                    "contentType": "html",
                    "content": "<p >Successfully post this info back to MS Teams, check the link: <a href={}>OneNote Page</a></p>\n".format(onenote_page_url)
                }
            }
            reply_message = json.dumps(reply_message, indent=4)

            endpoint = "https://graph.microsoft.com/v1.0/teams/{}/channels/{}/messages/{}/replies".format(
                teamId, channelId, replyToMessageId)
            try:
                data = requests.post(
                    endpoint, headers=http_headers, stream=False, data=reply_message)
            except:
                data = requests.post(
                    endpoint, headers=http_headers, stream=False, proxies=proxies, data=reply_message)
            if data.status_code == 202:
                print('<p >Successfully post this info back to MS Teams, check the link: <a href={}>OneNote Page</a></p>\n'.format(onenote_page_url))

    else:
        print('Something is missing for {} ---{}: {} \n'.format(0,
              stock, stock_name))
        print('                                                                                                \n')

    time.sleep(random.uniform(7, 13))

stock_Top_list = pd.DataFrame(stock_Top_list, columns=stock_Top_list_columns).sort_values(
    by=['利润表现好', '流动负债不高', '分红多'], ascending=False)
print(tabulate(stock_Top_list, headers='keys', tablefmt='simple',))
page_content = stock_Top_list.to_html()
# page_content = page_content.replace('\n','')
page_content = page_content.replace('<th></th>', '<th>item</th>')


#### Append OneNote page content ###
body_data_append = [
    {
        "target": "body",
        "action": "append",
        "content": page_content
    }
]

try:
    data = requests.patch(endpoint, headers=http_headers,
                          data=json.dumps(body_data_append, indent=4))
except:
    data = requests.patch(endpoint, headers=http_headers, data=json.dumps(
        body_data_append, indent=4), proxies=proxies)
