import random
import os
import requests
import time
from pandas import DataFrame as df
import pandas as pd
import yfinance as yf
import datetime

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


# To create a random string for East Money request #
def generate_random_string(length):
    # Generate a random string of the specified length
    return ''.join([str(random.randint(0, 9)) for _ in range(length)])

# To Get the Dividend data for each stock from East Money ##############################################
def Dividend_Data_Yearly_from_Easy_Money(stock_cn, proxies):
    print('Let\'s check if there are any dividend data for each year..... \n')
    string_v1 = generate_random_string(17)
    url_eastmoney_dividend = 'https://dat{}nter.eas{}ney.com/securities/api/data/v1/get?reportName=RPT_F10_DI{}ND_COMPRE&columns=ALL&quoteColumns=&filter=(SECUCODE%3D%22{}%22)&pageNumber=1&pageSize=16&sortTypes=-1&sortColumns=STATISTICS_YEAR&source=HSF10&client=PC&v={}'.format('ace', 'tmo', 'VIDE', stock_cn, string_v1)
    try:
        response_dividend = requests.get(
            url_eastmoney_dividend, headers=headers_eastmoney)
    except:
        response_dividend = requests.get(
            url_eastmoney_dividend, headers=headers_eastmoney, proxies=proxies)
    if response_dividend.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Dividend ...\n'.format(stock_cn))
        pass
    else:
        print(f"Failed to retrieve data: {response_dividend.status_code}")
    dividend_data_raw = response_dividend.json()['result']['data']
    time.sleep(random.uniform(15, 25))
    return dividend_data_raw


################# Define yearly report for each stock from East Money #################################
def Year_report_url(stock, stock_cn, p_income_year, p_cash_flow, p_balance_sheet, day_one):
    string_v1 = generate_random_string(17)
    string_v2 = generate_random_string(17)
    string_v3 = generate_random_string(18)

    if (stock[7:] == 'ss' or stock[7:] == 'sz') and (len(stock) == 9):  
        url_eastmoney_income = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format('ace', 'tmo', p_income_year, p_income_year, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v1)

        url_eastmoney_cash_flow = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format('ace', 'tmo', p_cash_flow, p_cash_flow, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v2)

        url_eastmoney_balance_sheet = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=F10_FINANCE_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format('ace', 'tmo', p_balance_sheet, p_balance_sheet, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v3)
    return [url_eastmoney_income, url_eastmoney_cash_flow, url_eastmoney_balance_sheet]


################# Define Seasonly report #################################################
def Seasonly_report_url(report_date_yearly, stock, stock_cn, p_income, p_cash_flow, p_balance_sheet):
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


def report_from_East_Money(url, proxies, stock_cn):

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
            temp_date = df_report_notification_date_y.iloc[i][:10]
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
        if bool(df_income_stock['DILUTED_EPS'].isna().all()) == True:
            stock_0_profit_margin_y = df_income_stock['BASIC_EPS']
        else:
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

        ################## 自由现金流 ##################
        ### 自由现金流＝ 净利润 + 折旧与摊销－资本支出－营运资本追加
        ##### 净利润: in Cash Flow, it is "NETPROFIT   "
        ##### 折旧与摊销: in Cash Flow, it is "FA_IR_DEPR"
        ##### 资本支出 : 现金流量表里面 的 投资活动现金流出小计中, 购建固定资产支付的现金, in Cash Flow, it is "CONSTRUCT_LONG_ASSET"
        ##### 营运资本（Working Capital）: 资产负债表：= 流动资产 - 流动负债；
        ##### 营运资本的变化（ΔWC）= 本期营运资本 - 上期营运资本
        #TODO
        stock_0_NetProfit_y = df_cash_flow['NETPROFIT']
        stock_0_FixAsset_Depr_y = df_cash_flow['FA_IR_DEPR']
        stock_0_Cash_OutFlow_y = df_cash_flow['CONSTRUCT_LONG_ASSET']
        stock_0_Delta_Working_Capital = (df_balance_sheet['TOTAL_CURRENT_ASSETS'] - df_balance_sheet['TOTAL_CURRENT_LIAB']).diff(-1)
        stock_0_Free_Cash_Flow = (stock_0_NetProfit_y + stock_0_FixAsset_Depr_y - stock_0_Cash_OutFlow_y - stock_0_Delta_Working_Capital)/100000000
        stock_0_Free_Cash_Flow.name = "自由现金流 亿元"


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

        ### UNASSIGN_RPOFIT ###
        # 每股未分配利润，为历年累加
        stock_0_UNASSIGN_RPOFIT_Total_y = df_balance_sheet['UNASSIGN_RPOFIT']/100000000
        stock_0_UNASSIGN_RPOFIT_Total_y.name = '未分配利润累积 亿元'
        stock_0_UNASSIGN_RPOFIT_y = df_balance_sheet['UNASSIGN_RPOFIT']/df_balance_sheet['SHARE_CAPITAL']
        stock_0_UNASSIGN_RPOFIT_y.name = '每股未分配利润累积'

        stock_output_y = pd.concat([stock_0_TotalRevenue_y, stock_0_TotalAssets_y, stock_0_EBIT_y, stock_0_CurrentAssets_y, stock_0_CurrentLiabilities_y, stock_0_CurrentAssets_vs_Liabilities_y, stock_0_Free_Cash_Flow, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y, stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_y, stock_0_OrdinarySharesNumber_y, stock_0_UNASSIGN_RPOFIT_Total_y, stock_0_UNASSIGN_RPOFIT_y, stock_0_profit_margin_y, stock_0_profit_margin_increase_y, stock_0_BookValue_per_Share_y, stock_price_less_than_BookValue_ratio_y, stock_price_less_than_PE_ratio_y], axis=1)
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
def get_stock_price_range(stock_output, stock, day_one, proxy_add):
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
def get_latest_7_days_stock_price(stock, proxy_add):
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
def save_data_to_OneDrive_newFile(stock_name, stock_data, stock, user_id, parent_id, result, proxies):
    stock_data.to_pickle('{}-Y-{}.pkl'.format(stock, stock_name))

    # 打开一个二进制文件进行读取
    with open('{}-Y-{}.pkl'.format(stock, stock_name), 'rb') as filedata:
        ### create a file file for this data:
        endpoint_create_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}:/{}-Y-{}.pkl:/content'.format(user_id,parent_id,stock, stock_name)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'}
        try:
            data_create_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_create_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata,stream=False, proxies=proxies)
        print('Uploaded Yearly data  to Created New file: status code is: {}----\n'.format(data_create_file.status_code))
        if data_create_file.status_code == 200:
            print('Yearly Data file uploaded to OneDrive Successfully!-------- \n')
    os.remove('{}-Y-{}.pkl'.format(stock, stock_name))

### below is to store monthly data to OneDrive ###
def save_monthly_data_to_OneDrive_newFile(stock_name, stock_data, stock, user_id, parent_id, result, proxies):
    stock_data.to_pickle('{}-M-{}_monthly.pkl'.format(stock, stock_name))

    # 打开一个二进制文件进行读取
    with open('{}-M-{}_monthly.pkl'.format(stock, stock_name), 'rb') as filedata:
        ### create a file file for this data:
        endpoint_create_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}:/{}-M-{}_monthly.pkl:/content'.format(user_id,parent_id,stock, stock_name)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'}
        try:
            data_create_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_create_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata,stream=False, proxies=proxies)
        print('Updated Monthly data file: status code is: {}----\n'.format(data_create_file.status_code))
        if data_create_file.status_code == 200:
            print('Monthly Data file uploaded to OneDrive Successfully!-------- \n')
    os.remove('{}-M-{}_monthly.pkl'.format(stock, stock_name))

### Define a update existing file to OneDrive Function ##############
def update_data_in_OneDrive(stock_name, stock_data, stock, user_id, data_file_id, result, proxies):
    stock_data.to_pickle('{}-Y-{}.pkl'.format(stock, stock_name))

    # 打开一个二进制文件进行读取
    with open('{}-Y-{}.pkl'.format(stock, stock_name), 'rb') as filedata:
        ### create a file file for this data:
        # endpoint_update_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}/content'.format(user_id,data_file_id,stock)
        endpoint_update_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}/content'.format(user_id,data_file_id)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'}
        try:
            data_update_file = requests.put(endpoint_update_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_update_file = requests.put(endpoint_update_file, headers=http_headers_create_file, data=filedata,stream=False, proxies=proxies)
        print('Updated Yearly data file: status code is: {}----\n'.format(data_update_file.status_code))
        if data_update_file.status_code == 200:
            print('Yearly Data file updated to OneDrive Successfully!-------- \n')
    os.remove('{}-Y-{}.pkl'.format(stock, stock_name))

### to update existing monthly data file to OneDrive Function ###
def update_monthly_data_in_OneDrive(stock_name, stock_data, stock, user_id, data_file_id, result, proxies):
    stock_data.to_pickle('{}-M-{}_monthly.pkl'.format(stock, stock_name))

    # 打开一个二进制文件进行读取
    with open('{}-M-{}_monthly.pkl'.format(stock, stock_name), 'rb') as filedata:
        ### create a file file for this data:
        endpoint_update_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}/content'.format(user_id,data_file_id,stock)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'}
        try:
            data_update_file = requests.put(endpoint_update_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_update_file = requests.put(endpoint_update_file, headers=http_headers_create_file, data=filedata,stream=False, proxies=proxies)
        print('Updated Monthly data file: status code is: {}----\n'.format(data_update_file.status_code))
        if data_update_file.status_code == 200:
            print('Monthly Data file updated to OneDrive Successfully!-------- \n')
    os.remove('{}-M-{}_monthly.pkl'.format(stock, stock_name))

### Define a Save New file to OneDrive Function ##############
def Save_File_To_OneDrive(file, user_id, parent_id, result, proxies):
    # 打开一个二进制文件进行读取
    with open(file, 'rb') as filedata:
        ### create a file file for this data:
        endpoint_create_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}:/{}:/content'.format(user_id,parent_id,file)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'}
        try:
            data_save_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_save_file = requests.put(endpoint_create_file, headers=http_headers_create_file, data=filedata,stream=False, proxies=proxies)
        print('File Saved to OneDrive: status code is: {}----\n'.format(data_save_file.status_code))
        if data_save_file.status_code == 200:
            print('Data file Saved to OneDrive Successfully!-------- \n')
    os.remove(file)


### Define the function for Ford Stock ##############################
def get_stock_info_for_F(stock, proxy_add):
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