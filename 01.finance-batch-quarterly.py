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


### Define the stock list you want ###

# https://data.eastmoney.com/other/index/hs300.html 沪深300成分股清单
# stock_code = [600885, 603259, 600276]

# stock_name = ['宏发股份', '药明康德', '恒瑞医药']

### stock_Top_list is to summarize the performance of each stock
stock_Top_list = []
stock_Top_list_columns = ['Stock Number', '利润表现好', '流动负债不高', '分红多']


# To create a random string for East Money request #
def generate_random_string(length):
    # Generate a random string of the specified length
    return ''.join([str(random.randint(0, 9)) for _ in range(length)])


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

## This is the header for East Money ##
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



################# Define yearly report for each stock from East Money #################################
def Year_report_url():
    string_v1 = generate_random_string(17)
    string_v2 = generate_random_string(17)
    string_v3 = generate_random_string(18)

    if (stock[7:] == 'ss' or stock[7:] == 'sz') and (len(stock) == 9):  
        url_eastmoney_income = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format('ace', 'tmo', p_income_year, p_income_year, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v1)

        url_eastmoney_cash_flow = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format('ace', 'tmo', p_cash_flow, p_cash_flow, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v2)

        url_eastmoney_balance_sheet = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=F10_FINANCE_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format('ace', 'tmo', p_balance_sheet, p_balance_sheet, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v3)
    return [url_eastmoney_income, url_eastmoney_cash_flow, url_eastmoney_balance_sheet]


################# Define Seasonly report #################################################
def Seasonly_report_url(report_date_yearly):
    string_v1 = generate_random_string(17)
    string_v2 = generate_random_string(17)
    string_v3 = generate_random_string(18)

    latest_report_date_Year = int(report_date_yearly.index[0][:4])
    next_year = str(latest_report_date_Year + 1)

    if (stock[7:] == 'ss' or stock[7:] == 'sz') and (len(stock) == 9):  
        url_eastmoney_income = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
            'ace', 'tmo', p_income, p_income, stock_cn, next_year, next_year, next_year, string_v1)

        url_eastmoney_cash_flow = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
            'ace', 'tmo', p_cash_flow, p_cash_flow, stock_cn, next_year, next_year, next_year, string_v2)

        url_eastmoney_balance_sheet = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=F10_FINANCE_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
            'ace', 'tmo', p_balance_sheet, p_balance_sheet, stock_cn, next_year, next_year, next_year, string_v3)
    
    return [url_eastmoney_income, url_eastmoney_cash_flow, url_eastmoney_balance_sheet]



def report_from_East_Money(url):

    url_eastmoney_income = url[0]
    url_eastmoney_cash_flow = url[1]
    url_eastmoney_balance_sheet = url[2]


    try:
        response_income = requests.get(
            url_eastmoney_income, headers=headers_eastmoney)
    except:
        response_income = requests.get(
            url_eastmoney_income, headers=headers_eastmoney, proxies=proxies)
    if response_income.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Income.\n'.format(stock_cn))
        pass
    else:
        print(f"Failed to retrieve data: {response_income.status_code}")
    time.sleep(random.uniform(15, 25))

    try:
        response_cash_flow = requests.get(
            url_eastmoney_cash_flow, headers=headers_eastmoney)
    except:
        response_cash_flow = requests.get(
            url_eastmoney_cash_flow, headers=headers_eastmoney, proxies=proxies)
    if response_cash_flow.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Cash Flow.\n'.format(stock_cn))
        pass
    else:
        print(f"Failed to retrieve data: {response_cash_flow.status_code}")
    time.sleep(random.uniform(15, 25))

    try:
        response_balance_sheet = requests.get(
            url_eastmoney_balance_sheet, headers=headers_eastmoney)
    except:
        response_balance_sheet = requests.get(
            url_eastmoney_balance_sheet, headers=headers_eastmoney, proxies=proxies)
    if response_balance_sheet.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Balance Sheet.\n'.format(stock_cn))
        pass
    else:
        print(
            f"Failed to retrieve data: {response_balance_sheet.status_code}")
    time.sleep(random.uniform(15, 25))

    try:
        df_income_stock = df(response_income.json()['result']['data'])
        df_cash_flow = df(response_cash_flow.json()['result']['data'])
        df_balance_sheet = df(response_balance_sheet.json()['result']['data'])

        stock_name_from_year_income = df_income_stock['SECURITY_NAME_ABBR'][0]

        df_income_stock = df_income_stock.set_index('REPORT_DATE_NAME')
        df_cash_flow = df_cash_flow.set_index('REPORT_DATE_NAME')
        df_balance_sheet = df_balance_sheet.set_index('REPORT_DATE_NAME')

        quarter_mapping_income = {
            '一季度': '-03-31',
            '二季度': '-06-30',
            '三季度': '-09-30',
            '四季度': '-12-31',
            '年报': '-12-31',
        }
        new_index_income = df_income_stock.index.to_series().replace(quarter_mapping_income, regex=True)
        df_income_stock = df_income_stock.set_index(pd.Index(new_index_income, name='REPORT_DATE_NAME'))

        quarter_mapping_cash_flow = {
            '一季报': '-03-31',
            '中报': '-06-30',
            '三季报': '-09-30',
            '年报': '-12-31',
        }
        new_index_cash_flow = df_cash_flow.index.to_series().replace(quarter_mapping_cash_flow, regex=True)
        df_cash_flow = df_cash_flow.set_index(pd.Index(new_index_cash_flow, name='REPORT_DATE_NAME'))
        df_balance_sheet = df_balance_sheet.set_index(pd.Index(new_index_cash_flow, name='REPORT_DATE_NAME'))

        # to get the report notice date 
        df_report_notification_date_y = df_income_stock['NOTICE_DATE']
        df_report_notification_date_y.name = '年报公布时间'

        notification_date_list = []
        for i in range(len(df_report_notification_date_y)):
            temp_date = df_report_notification_date_y[i][:10]
            notification_date_list.append(temp_date)

        ### How Big The Company Is ###
        # 销售额
        stock_0_TotalRevenue_y = df_income_stock['TOTAL_OPERATE_INCOME']/100000000
        stock_0_TotalRevenue_y.name = '营业总收入 销售额 亿元'
        # 总资产
        stock_0_TotalAssets_y = df_balance_sheet['TOTAL_ASSETS']/100000000
        stock_0_TotalAssets_y.name = '总资产 亿元'
        stock_0_EBIT_y = df_income_stock['OPERATE_PROFIT']/100000000  # 息税前利润
        stock_0_EBIT_y.name = '营业收入 息税前利润 亿元'

        ### Profit Stability of The Company ###
        # 每股稀释后收益 季度，每股收益
        stock_0_profit_margin_y = df_income_stock['DILUTED_EPS']
        stock_0_profit_margin_y.name = '稀释后 每年/季度每股收益 元'


        ### Profit Margin of The Company ###
        if any(map(lambda x: x == None, stock_0_profit_margin_y)):  # 查看利润是否有空值，此时无法计算
            stock_0_profit_margin_increase_y = []
            for ix in range(0, len(stock_0_profit_margin_y)-1):
                stock_0_profit_margin_increase_y.append(None)
            stock_0_profit_margin_increase_y.append(None)  # 最后一年
        else: # 没有空值，那么就可以正常进行计算操作
            stock_0_profit_margin_increase_y = []
            for ix in range(0, len(stock_0_profit_margin_y)-1):
                margin_increase = round(
                    (stock_0_profit_margin_y.values[ix] - stock_0_profit_margin_y.values[ix+1])/stock_0_profit_margin_y.values[ix+1], 2)
                stock_0_profit_margin_increase_y.append(margin_increase)

            stock_0_profit_margin_increase_y.append(1)  # 最后一年作为基数1
        
        stock_0_profit_margin_increase_list_y = stock_0_profit_margin_increase_y

        stock_0_profit_margin_increase_y = pd.DataFrame(
            stock_0_profit_margin_increase_y).set_index(stock_0_profit_margin_y.index)
        stock_0_profit_margin_increase_y = stock_0_profit_margin_increase_y.T.set_index([['每股利润增长率 x 100%']])
        stock_0_profit_margin_increase_y = stock_0_profit_margin_increase_y.T


        ### How Well The Company Financial Status is ###
        # 流动资产
        stock_0_CurrentAssets_y = df_balance_sheet['TOTAL_CURRENT_ASSETS']/100000000
        stock_0_CurrentAssets_y.name = '流动资产 亿元'
        # 流动负债
        stock_0_CurrentLiabilities_y = df_balance_sheet['TOTAL_CURRENT_LIAB']/100000000
        stock_0_CurrentLiabilities_y.name = '流动负债 亿元'
        # 流动资产与流动负债之比 应>2
        stock_0_CurrentAssets_vs_Liabilities_y = df_balance_sheet[
            'TOTAL_CURRENT_ASSETS']/df_balance_sheet['TOTAL_CURRENT_LIAB']
        stock_0_CurrentAssets_vs_Liabilities_y.name = '流动资产/流动负债>2'
        # 非流动负债合计，我认为是长期负债
        stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y = df_balance_sheet[
            'TOTAL_NONCURRENT_LIAB']/100000000
        stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y.name = '非流动负债'
        stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_y = stock_0_CurrentAssets_y - \
            stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y  # 流动资产扣除长期负债后应大于0
        stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_y.name = '流动资产-长期负债>0'

        ### Stock price vs Assets ratio ###
        # 无形资产
        stock_0_OtherIntangibleAssets_y = df_balance_sheet['INTANGIBLE_ASSET']/100000000
        # 总负债
        stock_0_TotalLiabilitiesNetMinorityInterest_y = df_balance_sheet[
            'TOTAL_LIABILITIES']/100000000
        # 普通股数量
        stock_0_OrdinarySharesNumber_y = df_balance_sheet['SHARE_CAPITAL']/1000000
        stock_0_OrdinarySharesNumber_y.name = '普通股数量 百万'
        stock_0_BookValue_y = stock_0_TotalAssets_y - stock_0_OtherIntangibleAssets_y - \
            stock_0_TotalLiabilitiesNetMinorityInterest_y  # 总账面价值
        stock_0_BookValue_per_Share_y = stock_0_BookValue_y * \
            100000000/(stock_0_OrdinarySharesNumber_y*1000000)  # 每股账面价值
        stock_0_BookValue_per_Share_y.name = '每股账面价值 元'
        stock_price_less_than_BookValue_ratio_y = stock_0_BookValue_per_Share_y * \
            1.5  # 按账面价值计算出来的目标股价
        stock_price_less_than_BookValue_ratio_y.name = '每股账面价值1.5倍元'

        ### PE Ratio of the Company ###
        stock_PE_ratio_target = 15  # 这个是目标市盈率，股份不超过这个可以考虑入手
        if 'INCOMEQC' in url_eastmoney_income: # meaning it is Seasonly data:
            stock_price_less_than_PE_ratio_y = stock_PE_ratio_target * \
                stock_0_profit_margin_y * 4  # 股份不能超过的值
        else: # Meaning it is yealy data, no need to x4
            stock_price_less_than_PE_ratio_y = stock_PE_ratio_target * \
                stock_0_profit_margin_y  # 股份不能超过的值
        stock_price_less_than_PE_ratio_y.name = '市盈率15对应股价 元'

        stock_output_y = pd.concat([stock_0_TotalRevenue_y, stock_0_TotalAssets_y, stock_0_EBIT_y, stock_0_CurrentAssets_y, stock_0_CurrentLiabilities_y, stock_0_CurrentAssets_vs_Liabilities_y, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y, stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_y, stock_0_OrdinarySharesNumber_y, stock_0_profit_margin_y, stock_0_profit_margin_increase_y, stock_0_BookValue_per_Share_y, stock_price_less_than_BookValue_ratio_y, stock_price_less_than_PE_ratio_y], axis=1)
        stock_output_y = stock_output_y.T.astype('float64').round(2)
 
        notice_date_df = pd.DataFrame(notification_date_list,index=stock_output_y.columns,columns=['Notice Date']).T
        stock_output_y = pd.concat([notice_date_df,stock_output_y],axis=0)


        # # df_income_stock.T.to_excel('00.in.xlsx',encoding='utf-8')
        # # df_cash_flow.T.to_excel('00.ca.xlsx',encoding='utf-8')
        # df_balance_sheet.T.to_excel('00.ba.xlsx',encoding='utf-8')
    except:
        print('Data is not available for {} in EasyMoney.\n'.format(stock_cn))
    return [stock_output_y, stock_name_from_year_income]



################# to get the stock price for each year #####################################
def get_stock_price_range(stock_output):
    print('Please Note: the stock price for the latest period is just to as of now...\n')
    time_list = list(stock_output.loc['Notice Date'])

    # to turn the report notification date into 2024-09-30 format ###

    stock_price_temp = []
    stock_target = yf.Ticker(stock)

    for i in range(0, len(time_list)):
        if i == 0:
            stock_price = stock_target.history(end=day_one.strftime('%Y-%m-%d'), start=time_list[i], proxy=proxy_add)
        else:
            stock_price = stock_target.history(end=time_list[i-1], start=time_list[i], proxy=proxy_add)

        if stock_price.empty:
            stock_price_high_low = 'None'
            stock_price_temp.append(stock_price_high_low)
        else:
            stock_price_high_low = '{:.2f}'.format(
                stock_price['High'].min()) + '-' + '{:.2f}'.format(stock_price['High'].max())
            # stock_price_high_low = str(int(stock_price['High'].min())) + '-' + str(int(stock_price['High'].max()))
            stock_price_temp.append(stock_price_high_low)
    stock_price_output = pd.DataFrame([stock_price_temp])
    stock_price_output.columns = list(stock_output.columns)

    stock_price_output = stock_price_output.rename(index={0: '后一年股价范围'})
    return stock_price_output


### to get the latest 7days(10actually) stock price #################################
def get_latest_7_days_stock_price():
    last_7_days_end = datetime.datetime.now().strftime('%Y-%m-%d')
    last_7_days_start = (datetime.datetime.now() -
                         datetime.timedelta(days=10)).strftime('%Y-%m-%d')

    stock_target = yf.Ticker(stock)

    last_7_days_stock_price = stock_target.history(
        start=last_7_days_start, end=last_7_days_end, proxy=proxy_add)
    if last_7_days_stock_price.empty:
        last_7_days_stock_price_high_low = 'None'
    else:
        last_7_days_stock_price_high_low = '{:.2f}'.format(last_7_days_stock_price['High'].min(
        )) + '-' + '{:.2f}'.format(last_7_days_stock_price['High'].max())
        # last_7_days_stock_price_high_low = str(int(last_7_days_stock_price['High'].min())) + '-' + str(int(last_7_days_stock_price['High'].max()))
    return last_7_days_stock_price_high_low



### Define function for saving Yearly data to OneDrive Function ####
def save_data_to_OneDrive_newFile(stock_data):
    stock_data.to_pickle('{}.pkl'.format(stock))

    # 打开一个二进制文件进行读取
    with open('{}.pkl'.format(stock), 'rb') as filedata:
        ### create a file file for this data:
        endpoint_create_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}:/{}.pkl:/content'.format(user_id,parent_id,stock)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'}
        try:
            data_create_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_create_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata,stream=False, proxies=proxies)
        # print('Uploaded data update file: status code is: {}----\n'.format(data_create_file.status_code))
        if data_create_file.status_code == 200:
            print('Data file uploaded to OneDrive Successfully!-------- \n')
    os.remove('{}.pkl'.format(stock))

### below is to store monthly data to OneDrive ###
def save_monthly_data_to_OneDrive_newFile(stock_data):
    stock_data.to_pickle('{}_monthly.pkl'.format(stock))

    # 打开一个二进制文件进行读取
    with open('{}_monthly.pkl'.format(stock), 'rb') as filedata:
        ### create a file file for this data:
        endpoint_create_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}:/{}_monthly.pkl:/content'.format(user_id,parent_id,stock)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'}
        try:
            data_create_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_create_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata,stream=False, proxies=proxies)
        # print('Uploaded data update file: status code is: {}----\n'.format(data_create_file.status_code))
        if data_create_file.status_code == 200:
            print('Monthly Data file uploaded to OneDrive Successfully!-------- \n')
    os.remove('{}_monthly.pkl'.format(stock))

### Define a update existing file to OneDrive Function ##############
def update_data_in_OneDrive(stock_data):
    stock_data.to_pickle('{}.pkl'.format(stock))

    # 打开一个二进制文件进行读取
    with open('{}.pkl'.format(stock), 'rb') as filedata:
        ### create a file file for this data:
        endpoint_update_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}/content'.format(user_id,data_file_id,stock)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'}
        try:
            data_update_file = requests.put(endpoint_update_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_update_file = requests.put(endpoint_update_file, headers=http_headers_create_file, data=filedata,stream=False, proxies=proxies)
        # print('Uploaded data update file: status code is: {}----\n'.format(data_update_file.status_code))
        if data_update_file.status_code == 200:
            print('Data file updated to OneDrive Successfully!-------- \n')
    os.remove('{}.pkl'.format(stock))

### to update existing monthly data file to OneDrive Function ###
def update_monthly_data_in_OneDrive(stock_data):
    stock_data.to_pickle('{}_monthly.pkl'.format(stock))

    # 打开一个二进制文件进行读取
    with open('{}_monthly.pkl'.format(stock), 'rb') as filedata:
        ### create a file file for this data:
        endpoint_update_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}/content'.format(user_id,data_file_id,stock)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'}
        try:
            data_update_file = requests.put(endpoint_update_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_update_file = requests.put(endpoint_update_file, headers=http_headers_create_file, data=filedata,stream=False, proxies=proxies)
        # print('Uploaded data update file: status code is: {}----\n'.format(data_update_file.status_code))
        if data_update_file.status_code == 200:
            print('Data file updated to OneDrive Successfully!-------- \n')
    os.remove('{}_monthly.pkl'.format(stock))

# config.read(['config1.cfg'])
# stock_settings = config['stock_name']
# stock = stock_settings['stock_name']

### Define the function for Ford Stock ##############################
def get_stock_info_for_F():
    ### 以下是对一只股票进行查询 ###
    stock_target = yf.Ticker(stock)
    stock_target_sales = stock_target.get_cashflow(
        freq='yearly', proxy=proxy_add)
    stock_target_balance_sheet = stock_target.get_balance_sheet(
        freq='yearly', proxy=proxy_add)
    stock_target_income = stock_target.get_income_stmt(
        freq='yearly', proxy=proxy_add)

    if 'EBIT' in stock_target_income.index and 'CurrentAssets' in stock_target_balance_sheet.index and 'TotalRevenue' in stock_target_income.index and 'TotalAssets' in stock_target_balance_sheet.index and 'CurrentLiabilities' in stock_target_balance_sheet.index and 'TotalNonCurrentLiabilitiesNetMinorityInterest' in stock_target_balance_sheet.index and 'DilutedEPS' in stock_target_income.index and 'OtherIntangibleAssets' in stock_target_balance_sheet.index and 'TotalLiabilitiesNetMinorityInterest' in stock_target_balance_sheet.index and 'OrdinarySharesNumber' in stock_target_balance_sheet.index:
        print('Data obtained from Yahoo Finance for {}: ----------\n'.format(stock))

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
        stock_0_profit_margin.name = '稀释后 每年/季度每股收益 元'
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

        # 流动资产/流动负债
        stock_0_CurrentAssets_vs_Liabilities = stock_target_balance_sheet.loc[
            'CurrentAssets']/stock_target_balance_sheet.loc['CurrentLiabilities']  # 流动资产与流动负债之比 应>2
        stock_0_CurrentAssets_vs_Liabilities.name = '流动资产/流动负债>2'
        stock_0_CurrentAssets_vs_Liabilities.index = stock_0_CurrentAssets_vs_Liabilities.index.strftime(
            '%Y-%m-%d')

        # 非流动负债, 长期负债
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


    ### to consolidate the output for each stock ###
    stock_output = pd.concat([stock_0_TotalRevenue, stock_0_TotalAssets, stock_0_EBIT, stock_0_CurrentAssets, stock_0_CurrentLiabilities, stock_0_CurrentAssets_vs_Liabilities, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest,
                             stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities, stock_0_OrdinarySharesNumber, stock_0_profit_margin, stock_0_profit_margin_increase, stock_0_BookValue_per_Share, stock_price_less_than_BookValue_ratio, stock_price_less_than_PE_ratio], axis=1)
    stock_output= stock_output.T.astype('float64').round(2)

    ### To get the stock price for each year ###
    duration = stock_output.columns
    stock_price_temp = []

    time_list = []
    for i in range(0, len(duration)):
        time_list.append(duration[i].split('-')[0])
    for i in range(0, len(time_list)):
        stock_price = stock_target.history(start=str(int(
            time_list[i])+1) + '-02-02', end=str(int(time_list[i])+2) + '-02-01', proxy=proxy_add)

        if stock_price.empty:
            stock_price_high_low = 'None'
            stock_price_temp.append(stock_price_high_low)
        else:
            stock_price_high_low = '{:.2f}'.format(
                stock_price['High'].min()) + '-' + '{:.2f}'.format(stock_price['High'].max())
            # stock_price_high_low = str(int(stock_price['High'].min())) + '-' + str(int(stock_price['High'].max()))
            stock_price_temp.append(stock_price_high_low)
        print('{} - {} - stock price range is: {}\n'.format(str(int(time_list[i])+1) + '-02-02',str(int(time_list[i])+2) + '-02-01',stock_price_high_low))
    stock_price_output = pd.DataFrame([stock_price_temp])
    stock_price_output.columns = duration
    stock_price_output = stock_price_output.rename(index={0: '后一年股价范围'})

    stock_output_combined = pd.concat([stock_output, stock_price_output], axis=0)
    stock_name_for_F = 'Ford'

    return [stock_output_combined, stock_name_for_F]




######## Below is the Main Function #################################

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


# to create a new page in OneNote to store the stock info...
# here, only define the endpoint, detailed info is listed down below after the data processing...
endpoint_create_page = 'https://graph.microsoft.com/v1.0/users/{}/onenote/sections/{}/pages'.format(user_id,finance_section_id)

for iii in range(0, len(stock_code)):  # 在所有的沪深300成分股里面进行查询..

    ### MS token expiration time info, refer to below link ###
    # https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes #

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

        http_headers_create_page = {'Authorization': 'Bearer ' + result['access_token'],
                      'Content-Type': 'application/xhtml+xml'}
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
        </body>
        </html>
        """.format(page_title,(datetime.datetime.now(datetime.timezone.utc)+ datetime.timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%S+08:00')).replace('\n','').strip()
        try:
           data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial)
        except:
           data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial,proxies=proxies)
        onenote_page_id = data.json()['id']  # this is the id for OneNote page created above.


        #### Append OneNote page content ###
        #### Only endpoint is defined here, detailed info for Append is listed down below after the data processing ###
        endpoint = 'https://graph.microsoft.com/v1.0/users/{}/onenote/pages/{}/content'.format(user_id,onenote_page_id)



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
        ### Check the Yearly Data File ###
        if check_item_name == 'yearly' and stock != 'F':
            endpoint_data_file = endpoint_parent + '{}.pkl'.format(stock)
        elif check_item_name == 'monthly' and stock != 'F':
            endpoint_data_file = endpoint_parent + '{}_monthly.pkl'.format(stock)
        else:
            endpoint_data_file = endpoint_parent + '{}.pkl'.format(stock)

        http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'}


        ### to check  if data exists: ####
        try:
            data_get_data = requests.get(endpoint_data_file, headers=http_headers, stream=False)
        except:
            data_get_data = requests.get(endpoint_data_file, headers=http_headers, stream=False, proxies=proxies)

        if data_get_data.status_code == 404: # no data, so we need to save it this time...
            if check_item_name == 'yearly':
                print('---------No Yearly data saved before, it\'s time to save it...---------\n')
            else:
                print('---------No Monthly data saved before, it\'s time to save it...---------\n')

            if stock == 'F':
                if check_item_name == 'yearly':
                    stock_output_combined_out = get_stock_info_for_F()
                    stock_output_combined = stock_output_combined_out[0]
                    stock_name = stock_output_combined_out[1]

                    save_data_to_OneDrive_newFile(stock_output_combined)
                    stock_output_yearly = stock_output_combined

            else: # for other stocks from SH/SZ:
                if check_item_name == 'yearly':
                    ### get the yearly report date ################################
                    url_yearly = Year_report_url()
                    yearly_report_raw_out = report_from_East_Money(url_yearly)
                    yearly_report_raw = yearly_report_raw_out[0] # for dataframe info
                    stock_name = yearly_report_raw_out[1] # for stock name

                    stock_output_yearly = yearly_report_raw

                    # call save data function
                    save_data_to_OneDrive_newFile(stock_output_yearly)

                else:
                    ### get the monthly report date ################################
                    try: # if yearly report just released, no seasonly report...
                        report_notification_date_yearly = stock_output_yearly.loc['Notice Date']

                        url_seasonly = Seasonly_report_url(report_notification_date_yearly)
                        Seasonly_report_raw_out = report_from_East_Money(url_seasonly)
                        Seasonly_report_raw = Seasonly_report_raw_out[0] # for dataframe info
                        stock_name = Seasonly_report_raw_out[1] # for stock name

                        stock_output_Seasonly = Seasonly_report_raw

                        # call save data function
                        save_monthly_data_to_OneDrive_newFile(stock_output_Seasonly)
                    except:
                        print('No seasonly report available as of now...\n')



        elif data_get_data.status_code == 200: # data saved before, check it.
            if check_item_name == 'yearly' and stock != 'F':
                print('-----Data existed in OneDrive, let\'s check if it is updated base on saved data latest report year...-----\n')
            elif check_item_name == 'monthly' and stock != 'F':
                print('-----Data existed in OneDrive, let\'s check if it is updated base on saved data latest report Season...-----\n')
            else:
                print('-----Data existed in OneDrive for Ford, let\'s check if it is updated base on saved data latest report year...-----\n')

            data_file_id = data_get_data.json()['id']
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
                    stock_output_combined_out = get_stock_info_for_F()
                    stock_output_combined = stock_output_combined_out[0]
                    stock_name = stock_output_combined_out[1]

                    ### to update data, keep the info just get, and remove the outdated info from OD
                    temp_output = pd.merge(stock_output_combined, yearly_report_from_OD, left_index=True, right_index=True, suffixes=('', '_y'))
                    cols_to_drop = [col for col in temp_output.columns if col.endswith('_y')]
                    temp_output.drop(columns=cols_to_drop, inplace=True)

                    temp_output = temp_output.set_index(stock_output_combined.index)
                    stock_output_yearly= temp_output.sort_index(axis=1, ascending=False) # to merge data together.

                    ### to update the data in OneDrive as well....
                    update_data_in_OneDrive(stock_output_yearly)

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
                    else:
                        print(':::: It\'s time to update the Yearly data now ...   ::::\n')
                        ### get the yearly report date ################################
                        url_yearly = Year_report_url()
                        yearly_report_raw_out = report_from_East_Money(url_yearly)
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
                        update_data_in_OneDrive(stock_output_yearly)
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

                            url_seasonly = Seasonly_report_url(report_notification_date_yearly)
                            Seasonly_report_raw_out = report_from_East_Money(url_seasonly)
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
                            update_monthly_data_in_OneDrive(stock_output_Seasonly)
                        except:
                            print('No seasonly report available as of now...\n')
                    pass
        else:
            pass


    
    ### to get the Seasonly report from the East Money ################################
    if stock == 'F':
        pass # no need to do so.
    else:
        ### this date is not saved everytime to OneDrive, as it's not necessary to do so.

        # print('------- To Get the  [Seasonly] report from the East Money ------------')
        # report_notification_date_yearly = stock_output_yearly.loc['Notice Date']

        # url_seasonly = Seasonly_report_url(report_notification_date_yearly)
        # Seasonly_report_raw_out = report_from_East_Money(url_seasonly)
        # Seasonly_report_raw = Seasonly_report_raw_out[0]
        # stock_name = Seasonly_report_raw_out[1]

        # report_notification_date_Seasonly = Seasonly_report_raw.loc['Notice Date']
        # stock_output_Seasonly = Seasonly_report_raw

        ### to get the stock price range from yahoo finance #############################
        print('------- To get the stock price range from Yahoo Finance ------------\n')
        stock_price_yearly = get_stock_price_range(stock_output_yearly)
        stock_price_Seasonly = get_stock_price_range(stock_output_Seasonly)

        ### to combine the stock price with the stock output #############################
        stock_output_yearly_f = pd.concat([stock_output_yearly, stock_price_yearly], axis=0)
        stock_output_Seasonly_f = pd.concat([stock_output_Seasonly, stock_price_Seasonly], axis=0)

        stock_output_combined = pd.concat([stock_output_Seasonly_f, stock_output_yearly_f], axis=1)


    stock_Top_temp.append('{}--{}-{}'.format(iii, stock, stock_name))


    ### to get the latest 10 days stock price #########################################
    last_7_days_stock_price_high_low = get_latest_7_days_stock_price()
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
        # page_content += "<div><p>This is the output for No. #{} ---{}: {}</p></div>".format(iii, stock, stock_name,)
        page_content += stock_output_combined.to_html()
        page_content += "<div><p>This is the last 10 days stock price for {} {}: {}</p></div>".format(
            stock, stock_name, last_7_days_stock_price_high_low)
        # page_content += "<div><p>This is the dividend for {}: {}</p></div>".format(
            # stock, stock_name)
        if stock_0_dividends.empty:
            page_content += "<div><p>No dividend record for {}: {}</p></div>".format(
                stock, stock_name)
        else:
            if len(stock_0_dividends) < 15:
                page_content += stock_0_dividends.to_frame().to_html()
            else:
                page_content += stock_0_dividends[-13:].to_frame().to_html()

        # page_content += "<div><p>{}--{}-{}, {}</p></div>".format(iii, stock, stock_name,dividends_perofrmance)
        # page_content += "<div><p>--------Complete this one : ↑ ↑ ↑ ↑ ↑  ---------------------</p></div>"
        page_content += "<div><p>                                                                                                </p></div>"
        # page_content = page_content.replace('\n','')
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
        print(tabulate(stock_output_combined, headers='keys', tablefmt='simple'))
        print('This is the last 10 days stock price for {} {}: {} \n'.format(
            stock, stock_name, last_7_days_stock_price_high_low))
        # print('This is the dividend for {}: {} \n'.format(stock, stock_name))
        print(stock_0_dividends)
        print('--------Complete this one : ↑ ↑ ↑ ↑ ↑  ---------------------\n')
        print('                                                                                                \n')

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



stock_Top_list = pd.DataFrame(stock_Top_list, columns=stock_Top_list_columns).sort_values(
    by=['利润表现好', '流动负债不高', '分红多'], ascending=False)
print(tabulate(stock_Top_list, headers='keys', tablefmt='simple',))
page_content = stock_Top_list.to_html()
# page_content = page_content.replace('\n','')
page_content = page_content.replace('<th></th>', '<th>item</th>')


login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
result = login_return['result']

### Create a OneNote Page for the summary ###
http_headers_create_page = {'Authorization': 'Bearer ' + result['access_token'],
              'Content-Type': 'application/xhtml+xml'}
page_title = 'Summary for {} Stock Info'.format(day_one.strftime('%Y-%m-%d'))

create_0 = """
<!DOCTYPE html>
<html>
<head>
<title>{}</title>
<meta name="created" content="{}" />
</head>
""".format(page_title,(datetime.datetime.now(datetime.timezone.utc)+ datetime.timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%S+08:00')).replace('\n','').strip()

create_1 = """
<body>
{}
</body>
</html>
""".format(page_content)

create_page_initial = create_0 + create_1

try:
   data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial.encode('utf-8'))
except:
   data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial.encode('utf-8'),proxies=proxies)
if data.status_code == 201:
    print('Created OneNote page successfully! \n')


print('Task Completed! \n')
