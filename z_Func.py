import random
import uuid
import os
import requests
import json
import time
from pandas import DataFrame as df
import pandas as pd
import yfinance as yf
import datetime
import funcLG
from bs4 import BeautifulSoup
import re
from typing import List, Optional

### to define the date for today, in order to get the year info ###
day_one = datetime.date.today()

## This is the header for Eas Mon ##
headers_easmon = {
    'Host': 'datacenter.eas{}ney.com'.format('tmo'),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.7,zh-CN;q=0.3',
    'Origin': 'https://emweb.securities.eas{}ney.com'.format('tmo'),
    'DNT': '1',
    'Referer': 'https://emweb.securities.eas{}ney.com/'.format('tmo'),
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
}

## This is the header for Eas Mon ##
headers_easmon_stock_list = {
    'Host': 'dat{}nter-w{}.eas{}ney.com'.format('ace', 'eb', 'tmo'),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.7,zh-CN;q=0.3',
    'Origin': 'https://emweb.securities.eas{}ney.com'.format('tmo'),
    'DNT': '1',
    'Referer': 'https://emweb.securities.eas{}ney.com/'.format('tmo'),
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
}

# To create a random string for Eas Mon request #


def generate_random_string(length):
    # Generate a random string of the specified length
    return ''.join([str(random.randint(0, 9)) for _ in range(length)])


def select_eps_with_fallback(income_df):
    """Prefer diluted EPS per period, falling back to basic EPS cell-by-cell."""
    index = income_df.index
    diluted = (pd.to_numeric(income_df['DILUTED_EPS'], errors='coerce')
               if 'DILUTED_EPS' in income_df.columns else
               pd.Series(index=index, dtype='float64'))
    basic = (pd.to_numeric(income_df['BASIC_EPS'], errors='coerce')
             if 'BASIC_EPS' in income_df.columns else
             pd.Series(index=index, dtype='float64'))
    out = diluted.combine_first(basic)
    out.name = '稀释后 每年/季度每股收益 元'
    return out


def calculate_fcf_with_direct_fallback(cashflow_df, balance_df):
    """Calculate A-share FCF, using direct cash flow where indirect is missing.

    Existing indirect values remain unchanged. Missing values fall back to
    NETCASH_OPERATE - CONSTRUCT_LONG_ASSET, which is available for companies
    such as 600104 even when NETPROFIT/FA_IR_DEPR or prior working capital are
    unavailable in quarterly feeds.
    """
    index = cashflow_df.index

    def series(frame, column, use_index=index):
        if column not in frame.columns:
            return pd.Series(index=use_index, dtype='float64')
        return pd.to_numeric(frame[column], errors='coerce').reindex(use_index)

    net_profit = series(cashflow_df, 'NETPROFIT')
    depreciation = series(cashflow_df, 'FA_IR_DEPR')
    capex = series(cashflow_df, 'CONSTRUCT_LONG_ASSET')
    current_assets = series(balance_df, 'TOTAL_CURRENT_ASSETS')
    current_liab = series(balance_df, 'TOTAL_CURRENT_LIAB')
    delta_working_capital = (current_assets - current_liab).diff(-1)
    indirect = net_profit + depreciation - capex - delta_working_capital
    direct = series(cashflow_df, 'NETCASH_OPERATE') - capex
    out = indirect.combine_first(direct) / 100000000
    out.name = '自由现金流 亿元'
    return out

# To Get the Dividend data for each stock from Eas Mon ##############################################


def Dividend_Data_Yearly_from_Eas_Mon(stock_cn, proxies):
    print('Let\'s check if there are any dividend data for each year..... \n')
    # string_v1 = generate_random_string(17)
    # url_easmon_dividend = 'https://dat{}nter.eas{}ney.com/securities/api/data/v1/get?reportName=RPT_F10_DI{}ND_COMPRE&columns=ALL&quoteColumns=&filter=(SECUCODE%3D%22{}%22)&pageNumber=1&pageSize=16&sortTypes=-1&sortColumns=STATISTICS_YEAR&source=HSF10&client=PC&v={}'.format('ace', 'tmo', 'VIDE', stock_cn, string_v1)
    string_v2 = generate_random_string(13)
    url_easmon_dividend = 'https://dat{}nter-web.eas{}ney.com/api/data/v1/get?sortColumns=REPORT_DATE&sortTypes=-1&pageSize=50&pageNumber=1&reportName=RPT_SHAREBONUS_DET&columns=ALL&quoteColumns=&js=%7B%22data%22%3A(x)%2C%22pages%22%3A(tp)%7D&source=WEB&client=WEB&filter=(SECURITY_CODE%3D%22{}%22)'.format(
        'ace', 'tmo', stock_cn[:6])
    try:
        response_dividend = requests.get(
            url_easmon_dividend, headers=headers_easmon)
    except:
        response_dividend = requests.get(
            url_easmon_dividend, headers=headers_easmon, proxies=proxies)
    if response_dividend.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Dividend ...\n'.format(stock_cn))
        pass
    else:
        print(f"Failed to retrieve data: {response_dividend.status_code}")
    dividend_data_raw = response_dividend.json()['result']['data']
    time.sleep(random.uniform(15, 25))
    return dividend_data_raw


################# Define yearly report for each stock from Eas Mon #################################
def Year_report_url(stock, stock_cn, p_income_year, p_cash_flow, p_balance_sheet, day_one):
    string_v1 = generate_random_string(17)
    string_v2 = generate_random_string(17)
    string_v3 = generate_random_string(18)

    if (stock[7:] == 'ss' or stock[7:] == 'sz') and (len(stock) == 9):
        url_easmon_income = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
            'ace', 'tmo', p_income_year, p_income_year, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v1)

        url_easmon_cash_flow = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
            'ace', 'tmo', p_cash_flow, p_cash_flow, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v2)

        url_easmon_balance_sheet = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=F10_FINANCE_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
            'ace', 'tmo', p_balance_sheet, p_balance_sheet, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v3)
    # Eight annual periods are requested above; ps=5 silently truncates them.
    return [u.replace('&ps=5&', '&ps=10&') for u in
            (url_easmon_income, url_easmon_cash_flow, url_easmon_balance_sheet)]


def Year_report_url_HK(day_one= day_one, stock_hk = '02359.HK'):
    """ To Define the HK Stock Yearly Report URL
    
    Args:
        day_one: datetime.date.today()
        stock_hk: 02359.HK,  use this format
    
    Returns:
        List: [HK Stock Yearly Report URL]
    
    """
    string_v1 = generate_random_string(17)
    string_v2 = generate_random_string(17)

    report_name_main = 'RPT_HKF10_FN_MAI{}CATOR'.format('NINDI')
    report_name_balance = 'RPT_HKF10_FN_BAL{}_PC'.format('ANCE')
    
    # stock_hk = '02359.HK'

    if (stock_hk[-2:] == 'HK'):
        # No REPORT_DATE filter: pull *all* disclosed periods (annual 12-31 +
        # interim 06-30 + quarterly 03-31/09-30 where the issuer reports them).
        # The batch/parser later splits them by DATE_TYPE_CODE (001=annual,
        # 002=interim, 003=Q1, 004=Q3). pageSize is enlarged to cover several
        # years of quarterly rows (main) and their per-item balance rows.
        url_easmon_main = 'https://dat{}nter.eas{}ney.com/securities/api/data/v1/get?reportName={}&columns=ALL&quoteColumns=&filter=(SECUCODE%3D%22{}%22)&pageNumber=1&pageSize=40&sortTypes=-1&sortColumns=STD_REPORT_DATE&source=F10&client=PC&v={}'.format(
            'ace', 'tmo', report_name_main, stock_hk, string_v1)
        url_easmon_balance = 'https://dat{}nter.eas{}ney.com/securities/api/data/v1/get?reportName={}&columns=ALL&quoteColumns=&filter=(SECUCODE%3D%22{}%22)&pageNumber=1&pageSize=2000&sortTypes=-1%2C1&sortColumns=REPORT_DATE%2CSTD_ITEM_CODE&source=F10&client=PC&v={}'.format(
            'ace', 'tmo', report_name_balance, stock_hk, string_v2)


    return [url_easmon_main, url_easmon_balance]

################# Define Seasonly report #################################################


def Seasonly_report_url(report_date_yearly, stock, stock_cn, p_income, p_cash_flow, p_balance_sheet):
    string_v1 = generate_random_string(17)
    string_v2 = generate_random_string(17)
    string_v3 = generate_random_string(18)

    latest_report_date_Year = int(report_date_yearly.index[0][:4])
    next_year = str(latest_report_date_Year + 1)

    if (stock[7:] == 'ss' or stock[7:] == 'sz') and (len(stock) == 9):
        url_easmon_income = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
            'ace', 'tmo', p_income, p_income, stock_cn, next_year, next_year, next_year, string_v1)

        url_easmon_cash_flow = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
            'ace', 'tmo', p_cash_flow, p_cash_flow, stock_cn, next_year, next_year, next_year, string_v2)

        url_easmon_balance_sheet = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=F10_FINANCE_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
            'ace', 'tmo', p_balance_sheet, p_balance_sheet, stock_cn, next_year, next_year, next_year, string_v3)

    return [url_easmon_income, url_easmon_cash_flow, url_easmon_balance_sheet]


def _eastmoney_probe_get(params, proxies=None):
    """Small strict F10 probe request; raises on network/schema failures."""
    url = 'https://datacenter.eastmoney.com/securities/api/data/v1/get'
    try:
        resp = requests.get(url, params=params, headers=headers_easmon, timeout=25)
    except requests.exceptions.RequestException:
        resp = requests.get(
            url, params=params, headers=headers_easmon,
            proxies=proxies, timeout=25)
    resp.raise_for_status()
    result = resp.json().get('result') or {}
    data = result.get('data')
    if data is None:
        raise RuntimeError('EastMoney report probe returned no data field')
    return data


def probe_latest_reports_a(stock_cn, proxies=None):
    """Return the latest four A-share report identity tuples.

    Each tuple is (REPORT_DATE, REPORT_TYPE, NOTICE_DATE). NOTICE_DATE is the
    real disclosure date; UPDATE_DATE is intentionally not used.
    """
    rows = _eastmoney_probe_get({
        'reportName': 'RPT_F10_FINANCE_GINCOME',
        'columns': ('SECUCODE,REPORT_DATE,REPORT_TYPE,REPORT_DATE_NAME,'
                    'NOTICE_DATE,UPDATE_DATE'),
        'filter': '(SECUCODE="{}")'.format(stock_cn),
        'pageNumber': '1', 'pageSize': '4',
        'sortTypes': '-1', 'sortColumns': 'REPORT_DATE',
        'source': 'F10', 'client': 'PC',
    }, proxies=proxies)
    return [(str(r.get('REPORT_DATE') or '')[:10],
             str(r.get('REPORT_TYPE') or r.get('REPORT_DATE_NAME') or ''),
             str(r.get('NOTICE_DATE') or '')[:10]) for r in rows]


def probe_latest_report_hk(stock_hk, proxies=None):
    """Return latest HK report identity (period, type code, type name).

    The HK main-indicator feed has no reliable publication date; REPORT_DATE is
    a period end and is never treated as Notice Date.
    """
    rows = _eastmoney_probe_get({
        'reportName': 'RPT_HKF10_FN_MAININDICATOR',
        'columns': ('SECUCODE,STD_REPORT_DATE,REPORT_DATE,'
                    'DATE_TYPE_CODE,REPORT_TYPE'),
        'filter': '(SECUCODE="{}")'.format(stock_hk),
        'pageNumber': '1', 'pageSize': '1',
        'sortTypes': '-1', 'sortColumns': 'STD_REPORT_DATE',
        'source': 'F10', 'client': 'PC',
    }, proxies=proxies)
    if not rows:
        return None
    r = rows[0]
    return (str(r.get('STD_REPORT_DATE') or '')[:10],
            str(r.get('DATE_TYPE_CODE') or ''),
            str(r.get('REPORT_TYPE') or ''))


def report_from_Eas_Mon(url, proxies, stock_cn):

    url_easmon_income = url[0]
    url_easmon_cash_flow = url[1]
    url_easmon_balance_sheet = url[2]

    try:
        response_income = requests.get(
            url_easmon_income, headers=headers_easmon)
    except:
        response_income = requests.get(
            url_easmon_income, headers=headers_easmon, proxies=proxies)
    if response_income.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Income.\n'.format(stock_cn))
        pass
    else:
        print(f"Failed to retrieve data: {response_income.status_code}")
    time.sleep(random.uniform(15, 25))

    try:
        response_cash_flow = requests.get(
            url_easmon_cash_flow, headers=headers_easmon)
    except:
        response_cash_flow = requests.get(
            url_easmon_cash_flow, headers=headers_easmon, proxies=proxies)
    if response_cash_flow.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Cash Flow.\n'.format(stock_cn))
        pass
    else:
        print(f"Failed to retrieve data: {response_cash_flow.status_code}")
    time.sleep(random.uniform(15, 25))

    try:
        response_balance_sheet = requests.get(
            url_easmon_balance_sheet, headers=headers_easmon)
    except:
        response_balance_sheet = requests.get(
            url_easmon_balance_sheet, headers=headers_easmon, proxies=proxies)
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
        new_index_income = df_income_stock.index.to_series().replace(
            quarter_mapping_income, regex=True)
        df_income_stock = df_income_stock.set_index(
            pd.Index(new_index_income, name='REPORT_DATE_NAME'))

        quarter_mapping_cash_flow = {
            '一季报': '-03-31',
            '中报': '-06-30',
            '三季报': '-09-30',
            '年报': '-12-31',
        }
        new_index_cash_flow = df_cash_flow.index.to_series().replace(
            quarter_mapping_cash_flow, regex=True)
        df_cash_flow = df_cash_flow.set_index(
            pd.Index(new_index_cash_flow, name='REPORT_DATE_NAME'))
        df_balance_sheet = df_balance_sheet.set_index(
            pd.Index(new_index_cash_flow, name='REPORT_DATE_NAME'))

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
        # Prefer diluted EPS per period; use basic EPS for individual blanks.
        stock_0_profit_margin_y = select_eps_with_fallback(df_income_stock)

        ### Profit Margin of The Company ###
        if any(map(lambda x: x == None, stock_0_profit_margin_y)):  # 查看利润是否有空值，此时无法计算
            stock_0_profit_margin_increase_y = []
            for ix in range(0, len(stock_0_profit_margin_y)-1):
                stock_0_profit_margin_increase_y.append(None)
            stock_0_profit_margin_increase_y.append(None)  # 最后一年
        else:  # 没有空值，那么就可以正常进行计算操作
            stock_0_profit_margin_increase_y = []
            for ix in range(0, len(stock_0_profit_margin_y)-1):
                margin_increase = round(
                    (stock_0_profit_margin_y.values[ix] - stock_0_profit_margin_y.values[ix+1])/stock_0_profit_margin_y.values[ix+1], 2)
                stock_0_profit_margin_increase_y.append(margin_increase)

            stock_0_profit_margin_increase_y.append(1)  # 最后一年作为基数1

        stock_0_profit_margin_increase_list_y = stock_0_profit_margin_increase_y

        stock_0_profit_margin_increase_y = pd.DataFrame(
            stock_0_profit_margin_increase_y).set_index(stock_0_profit_margin_y.index)
        stock_0_profit_margin_increase_y = stock_0_profit_margin_increase_y.T.set_index([
                                                                                        ['每股利润增长率 x 100%']])
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
        # 自由现金流＝ 净利润 + 折旧与摊销－资本支出－营运资本追加
        # 净利润: in Cash Flow, it is "NETPROFIT   "
        # 折旧与摊销: in Cash Flow, it is "FA_IR_DEPR"
        # 资本支出 : 现金流量表里面 的 投资活动现金流出小计中, 购建固定资产支付的现金, in Cash Flow, it is "CONSTRUCT_LONG_ASSET"
        # 营运资本（Working Capital）: 资产负债表：= 流动资产 - 流动负债；
        # 营运资本的变化（ΔWC）= 本期营运资本 - 上期营运资本
        stock_0_Free_Cash_Flow = calculate_fcf_with_direct_fallback(
            df_cash_flow, df_balance_sheet)

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

        ############  清算价值  #########################
        ######### 约等于 流动资产价值 #####################
        stock_0_liquidation_value_per_share_y = (
            stock_0_CurrentAssets_y*100000000)/(stock_0_OrdinarySharesNumber_y*1000000)
        stock_0_liquidation_value_per_share_y.name = '每股清算价值（按流动资产估算）'

        ### PE Ratio of the Company ###
        stock_PE_ratio_target = 15  # 这个是目标市盈率，股份不超过这个可以考虑入手
        if 'INCOMEQC' in url_easmon_income:  # meaning it is Seasonly data:
            stock_price_less_than_PE_ratio_y = stock_PE_ratio_target * \
                stock_0_profit_margin_y * 4  # 股份不能超过的值
        else:  # Meaning it is yealy data, no need to x4
            stock_price_less_than_PE_ratio_y = stock_PE_ratio_target * \
                stock_0_profit_margin_y  # 股份不能超过的值
        stock_price_less_than_PE_ratio_y.name = '市盈率15对应股价 元'

        ### UNASSIGN_RPOFIT ###
        # 每股未分配利润，为历年累加
        stock_0_UNASSIGN_RPOFIT_Total_y = df_balance_sheet['UNASSIGN_RPOFIT']/100000000
        stock_0_UNASSIGN_RPOFIT_Total_y.name = '未分配利润累积 亿元'
        stock_0_UNASSIGN_RPOFIT_y = df_balance_sheet['UNASSIGN_RPOFIT'] / \
            df_balance_sheet['SHARE_CAPITAL']
        stock_0_UNASSIGN_RPOFIT_y.name = '每股未分配利润累积'

        ############### 每股现金资产 #################
        stock_0_Cash_and_Cash_Equivalentsi_per_share_y = df_balance_sheet[
            'MONETARYFUNDS']/df_balance_sheet['SHARE_CAPITAL']
        stock_0_Cash_and_Cash_Equivalentsi_per_share_y.name = '每股现金资产'

        stock_output_y = pd.concat([stock_0_TotalRevenue_y, stock_0_TotalAssets_y, stock_0_EBIT_y, stock_0_CurrentAssets_y, stock_0_CurrentLiabilities_y, stock_0_CurrentAssets_vs_Liabilities_y, stock_0_Free_Cash_Flow, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y, stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_y, stock_0_OrdinarySharesNumber_y,
                                   stock_0_UNASSIGN_RPOFIT_Total_y, stock_0_UNASSIGN_RPOFIT_y, stock_0_profit_margin_y, stock_0_profit_margin_increase_y, stock_0_BookValue_per_Share_y, stock_price_less_than_BookValue_ratio_y, stock_price_less_than_PE_ratio_y, stock_0_liquidation_value_per_share_y, stock_0_Cash_and_Cash_Equivalentsi_per_share_y], axis=1)
        stock_output_y = stock_output_y.T.astype('float64').round(2)

        notice_date_df = pd.DataFrame(
            notification_date_list, index=stock_output_y.columns, columns=['Notice Date']).T
        stock_output_y = pd.concat([notice_date_df, stock_output_y], axis=0)

        # # df_income_stock.T.to_excel('00.in.xlsx',encoding='utf-8')
        # # df_cash_flow.T.to_excel('00.ca.xlsx',encoding='utf-8')
        # df_balance_sheet.T.to_excel('00.ba.xlsx',encoding='utf-8')
    except:
        print('Data is not available for {} in EasMon.\n'.format(stock_cn))
    return [stock_output_y, stock_name_from_year_income]

def fetch_cashflow_data_HK(proxies, stock_hk="02359.HK", day_one = day_one):
    """获取东方财富现金流量表数据（全部报告期：年报+中期+季度）。"""
    # No REPORT_DATE filter: pull every disclosed period so interim/quarterly
    # FCF is available too. The parser aligns each period by REPORT_DATE.
    print('查看的自由现金流：全部报告期（年报/中期/季度）')

    url = "https://datacenter.eastmoney.com/securities/api/data/v1/get"
    params = {
        "reportName": "RPT_HKF10_FN_CASHFLOW_PC",
        "columns": "SECUCODE,REPORT_DATE,STD_ITEM_CODE,STD_ITEM_NAME,AMOUNT",
        "filter": f'(SECUCODE="{stock_hk}")',
        "sortColumns": "REPORT_DATE,STD_ITEM_CODE",
        "sortTypes": "-1,1",
        "pageSize": "2000",
        "source": "F10", "client": "PC"
    }
    try:
        resp = requests.get(url, params=params, headers=headers_easmon)
    except:
        resp = requests.get(url, params=params, headers=headers_easmon, proxies=proxies)
    if resp.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Cash Flow...\n'.format(stock_hk))
        pass
    else:
        print(f"Failed to retrieve data --- Cash Flow : {resp.status_code}")
    time.sleep(random.uniform(15, 25))

    data = resp.json()["result"]["data"]
    return pd.DataFrame(data)

def calc_fcf_direct(df):
    """自由现金流:    直接法：经营现金净额 - CapEx"""
    # 透视表：按报告日期+项目名聚合
    pivot = df.pivot_table(index=["REPORT_DATE", "STD_ITEM_NAME"], values="AMOUNT", aggfunc="first").reset_index()
    
    # 提取关键字段
    ocf = pivot[pivot["STD_ITEM_NAME"]=="经营业务现金净额"][["REPORT_DATE", "AMOUNT"]].rename(columns={"AMOUNT": "OCF"})
    capex = pivot[pivot["STD_ITEM_NAME"]=="购建固定资产"][["REPORT_DATE", "AMOUNT"]].rename(columns={"AMOUNT": "CapEx"})
    
    # 合并计算
    result = ocf.merge(capex, on="REPORT_DATE", how="inner")
    result["FCF_Direct"] = result["OCF"] - result["CapEx"]
    result["自由现金流 亿元"] = result["FCF_Direct"] / 1e8  # 转换为亿元
    return result[["REPORT_DATE", "自由现金流 亿元"]]


def report_from_Eas_Mon_HK(url, proxies, stock_hk):

    # Pre-bind so the bare-except fallback never returns undefined names.
    stock_output_y = None
    stock_name_from_year_income = ''
    dps_map = {}
    # {period 'YYYY-MM-DD' -> DATE_TYPE_CODE}: 001=annual, 002=interim(H1),
    # 003=Q1, 004=Q3. Lets the batch split yearly vs seasonly columns.
    date_type_map = {}

    url_easmon_income = url[0]
    url_easmon_balance = url[1]

    try:
        response_income = requests.get(
            url_easmon_income, headers=headers_easmon)
    except:
        response_income = requests.get(
            url_easmon_income, headers=headers_easmon, proxies=proxies)
    if response_income.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Income.\n'.format(stock_hk))
        pass
    else:
        print(f"Failed to retrieve data for ---- Income : {response_income.status_code}")
    time.sleep(random.uniform(15, 25))

    try:
        response_balance = requests.get(
            url_easmon_balance, headers=headers_easmon)
    except:
        response_balance = requests.get(
            url_easmon_balance, headers=headers_easmon, proxies=proxies)
    if response_balance.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Balance Sheet.\n'.format(stock_hk))
        pass
    else:
        print(f"Failed to retrieve data --- Balance Sheet : {response_balance.status_code}")
    time.sleep(random.uniform(15, 25))

    try:
        df_income_stock = df(response_income.json()['result']['data'])
        stock_name_from_year_income = df_income_stock['SECURITY_NAME_ABBR'][0]

        df_balance_stock = df(response_balance.json()['result']['data'])

        df_income_stock = df_income_stock.set_index('STD_REPORT_DATE')
        df_balance_stock = df_balance_stock.set_index('STD_REPORT_DATE')

        # quarter_mapping_income = {
        #     '一季度': '-03-31',
        #     '二季度': '-06-30',
        #     '三季度': '-09-30',
        #     '四季度': '-12-31',
        #     '年报': '-12-31',
        # }
        # new_index_income = df_income_stock.index.to_series().replace(
        #     quarter_mapping_income, regex=True)
        # df_income_stock = df_income_stock.set_index(
        #     pd.Index(new_index_income, name='REPORT_DATE_NAME'))

        # to get the report notice date
        df_report_notification_date_y = df_income_stock['REPORT_DATE']
        df_report_notification_date_y.name = '年报公布时间'

        # notification_date_list = []
        # for i in range(len(df_report_notification_date_y)):
        #     temp_date = df_report_notification_date_y.iloc[i][:10]
        #     notification_date_list.append(temp_date)

        ### How Big The Company Is ###
        # 销售额
        stock_0_TotalRevenue_y = df_income_stock['OPERATE_INCOME']/100000000
        stock_0_TotalRevenue_y.name = '营业总收入 销售额 亿元'
        # 总资产
        stock_0_TotalAssets_y = df_income_stock['TOTAL_ASSETS']/100000000
        stock_0_TotalAssets_y.name = '总资产 亿元'
        stock_0_EBIT_y = df_income_stock['OPERATE_PROFIT']/100000000  # 息税前利润
        stock_0_EBIT_y.name = '营业收入 息税前利润 亿元'

        ### Profit Stability of The Company ###
        # Prefer diluted EPS per period; use basic EPS for individual blanks.
        stock_0_profit_margin_y = select_eps_with_fallback(df_income_stock)

        ### Profit Margin of The Company ###
        if any(map(lambda x: x == None, stock_0_profit_margin_y)):  # 查看利润是否有空值，此时无法计算
            stock_0_profit_margin_increase_y = []
            for ix in range(0, len(stock_0_profit_margin_y)-1):
                stock_0_profit_margin_increase_y.append(None)
            stock_0_profit_margin_increase_y.append(None)  # 最后一年
        else:  # 没有空值，那么就可以正常进行计算操作
            stock_0_profit_margin_increase_y = []
            for ix in range(0, len(stock_0_profit_margin_y)-1):
                margin_increase = round(
                    (stock_0_profit_margin_y.values[ix] - stock_0_profit_margin_y.values[ix+1])/stock_0_profit_margin_y.values[ix+1], 2)
                stock_0_profit_margin_increase_y.append(margin_increase)

            stock_0_profit_margin_increase_y.append(1)  # 最后一年作为基数1

        stock_0_profit_margin_increase_list_y = stock_0_profit_margin_increase_y

        stock_0_profit_margin_increase_y = pd.DataFrame(
            stock_0_profit_margin_increase_y).set_index(stock_0_profit_margin_y.index)
        stock_0_profit_margin_increase_y = stock_0_profit_margin_increase_y.T.set_index([
                                                                                        ['每股利润增长率 x 100%']])
        stock_0_profit_margin_increase_y = stock_0_profit_margin_increase_y.T

        ### How Well The Company Financial Status is ###
        # 流动资产
        stock_0_CurrentAssets_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "流动资产合计"]['AMOUNT']/100000000)
        stock_0_CurrentAssets_y.name = '流动资产 亿元'
        # 流动负债
        stock_0_CurrentLiabilities_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "流动负债合计"]['AMOUNT']/100000000)
        stock_0_CurrentLiabilities_y.name = '流动负债 亿元'
        # 流动资产与流动负债之比 应>2
        stock_0_CurrentAssets_vs_Liabilities_y = stock_0_CurrentAssets_y / stock_0_CurrentLiabilities_y
        stock_0_CurrentAssets_vs_Liabilities_y.name = '流动资产/流动负债>2'
        # 非流动负债合计，我认为是长期负债
        stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "非流动负债合计"]['AMOUNT']/100000000)
        stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y.name = '非流动负债'
        stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_y = stock_0_CurrentAssets_y - \
            stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y  # 流动资产扣除长期负债后应大于0
        stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_y.name = '流动资产-长期负债>0'

        ################## 自由现金流 ##################
        # 自由现金流＝ 净利润 + 折旧与摊销－资本支出－营运资本追加
        # 净利润: in Cash Flow, it is "NETPROFIT   "
        # 折旧与摊销: in Cash Flow, it is "FA_IR_DEPR"
        # 资本支出 : 现金流量表里面 的 投资活动现金流出小计中, 购建固定资产支付的现金, in Cash Flow, it is "CONSTRUCT_LONG_ASSET"
        # 营运资本（Working Capital）: 资产负债表：= 流动资产 - 流动负债；
        # 营运资本的变化（ΔWC）= 本期营运资本 - 上期营运资本
        cash_flow_df = fetch_cashflow_data_HK(proxies=proxies, stock_hk=stock_hk)
        df_Cash_Flow = calc_fcf_direct(cash_flow_df).sort_values(by='REPORT_DATE', ascending=False).reset_index(drop=True)
        df_Cash_Flow= df_Cash_Flow.set_index('REPORT_DATE')
        stock_0_Free_Cash_Flow = df_Cash_Flow['自由现金流 亿元']
        print("自由现金流 亿元:\n", stock_0_Free_Cash_Flow)
        # stock_0_NetProfit_y = df_cash_flow['NETPROFIT']
        # stock_0_FixAsset_Depr_y = df_cash_flow['FA_IR_DEPR']
        # stock_0_Cash_OutFlow_y = df_cash_flow['CONSTRUCT_LONG_ASSET']
        # stock_0_Delta_Working_Capital = (
        #     df_balance_sheet['TOTAL_CURRENT_ASSETS'] - df_balance_sheet['TOTAL_CURRENT_LIAB']).diff(-1)
        # stock_0_Free_Cash_Flow = (stock_0_NetProfit_y + stock_0_FixAsset_Depr_y -
        #                           stock_0_Cash_OutFlow_y - stock_0_Delta_Working_Capital)/100000000
        # stock_0_Free_Cash_Flow.name = "自由现金流 亿元"

        ### Stock price vs Assets ratio ###
        # 无形资产
        stock_0_OtherIntangibleAssets_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "无形资产"]['AMOUNT']/1000000)
        stock_0_OtherIntangibleAssets_y.name = '无形资产 百万'
        # 总负债
        stock_0_TotalLiabilitiesNetMinorityInterest_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "总负债"]['AMOUNT']/100000000)
        stock_0_TotalLiabilitiesNetMinorityInterest_y.name = '总负债 亿元'
        # 普通股数量
        stock_0_OrdinarySharesNumber_y = df_income_stock['HK_COMMON_SHARES']/1000000
        stock_0_OrdinarySharesNumber_y.name = '普通股数量 百万'

        # 现金调整账面价值: 现金调整BookValue = (股东权益 − 无形资产 − 商誉 + 净现金) ÷ 股数
        # 其中：净现金 = 现金及等价物 − 有息负债
        stock_0_ShareHolder_Eqt_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "股东权益"]['AMOUNT']/1000000)
        stock_0_ShareHolder_Eqt_y.name = '股东权益 百万'
        stock_0_Shangyu_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "商誉"]['AMOUNT']/1000000)
        stock_0_Shangyu_y.name = '商誉 百万'

        ############### 每股现金资产 #################
        stock_0_Cash_and_Cash_Equivalentsi_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "现金及等价物"]['AMOUNT']/1000000)
        stock_0_Cash_and_Cash_Equivalentsi_y.name = '现金及等价物 百万'
        stock_0_Cash_and_Cash_Equivalentsi_per_share_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "现金及等价物"]['AMOUNT']/100000000)\
            /stock_0_TotalLiabilitiesNetMinorityInterest_y
        stock_0_Cash_and_Cash_Equivalentsi_per_share_y.name = '每股现金资产'

        # 总账面价值
        stock_0_BookValue_y = stock_0_ShareHolder_Eqt_y - stock_0_OtherIntangibleAssets_y - stock_0_Shangyu_y + stock_0_Cash_and_Cash_Equivalentsi_y
        stock_0_BookValue_per_Share_y = stock_0_BookValue_y/(stock_0_OrdinarySharesNumber_y)  # 每股账面价值
        stock_0_BookValue_per_Share_y.name = '每股账面价值 元'
        stock_price_less_than_BookValue_ratio_y = stock_0_BookValue_per_Share_y * \
            1.5  # 按账面价值计算出来的目标股价
        stock_price_less_than_BookValue_ratio_y.name = '每股账面价值1.5倍元'

        ############  清算价值  #########################
        ######### 约等于 流动资产价值 #####################
        stock_0_liquidation_value_per_share_y = (
            stock_0_CurrentAssets_y*100000000)/(stock_0_OrdinarySharesNumber_y*1000000)
        stock_0_liquidation_value_per_share_y.name = '每股清算价值（按流动资产估算）'

        ### PE Ratio of the Company ###
        stock_PE_ratio_target = 15  # 这个是目标市盈率，股份不超过这个可以考虑入手
        if 'INCOMEQC' in url_easmon_income:  # meaning it is Seasonly data(#TODO, to be updated, since for HongKong, the INCOMEQC may not be used):
            stock_price_less_than_PE_ratio_y = stock_PE_ratio_target * \
                stock_0_profit_margin_y * 4  # 股份不能超过的值
        else:  # Meaning it is yealy data, no need to x4
            stock_price_less_than_PE_ratio_y = stock_PE_ratio_target * \
                stock_0_profit_margin_y  # 股份不能超过的值
        stock_price_less_than_PE_ratio_y.name = '市盈率15对应股价 元'

        ### UNASSIGN_RPOFIT ###
        # 每股未分配利润，为历年累加
        stock_0_UNASSIGN_RPOFIT_Total_y = (df_balance_stock[df_balance_stock['STD_ITEM_NAME'] == "储备"]['AMOUNT']/100000000)
        stock_0_UNASSIGN_RPOFIT_Total_y.name = '未分配利润累积 亿元'
        stock_0_UNASSIGN_RPOFIT_y = stock_0_UNASSIGN_RPOFIT_Total_y / \
            stock_0_TotalLiabilitiesNetMinorityInterest_y
        stock_0_UNASSIGN_RPOFIT_y.name = '每股未分配利润累积'

        stock_output_y = pd.concat([stock_0_TotalRevenue_y, stock_0_TotalAssets_y, stock_0_EBIT_y, stock_0_CurrentAssets_y, stock_0_CurrentLiabilities_y, stock_0_CurrentAssets_vs_Liabilities_y, stock_0_Free_Cash_Flow, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y, stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_y, stock_0_OrdinarySharesNumber_y,
                                   stock_0_UNASSIGN_RPOFIT_Total_y, stock_0_UNASSIGN_RPOFIT_y, stock_0_profit_margin_y, stock_0_profit_margin_increase_y, stock_0_BookValue_per_Share_y, stock_price_less_than_BookValue_ratio_y, stock_price_less_than_PE_ratio_y, stock_0_liquidation_value_per_share_y, stock_0_Cash_and_Cash_Equivalentsi_per_share_y], axis=1)
        stock_output_y = stock_output_y.T.astype('float64').round(2)
        # HK STD_REPORT_DATE columns come as '2025-12-31 00:00:00'; truncate to
        # the plain 'YYYY-MM-DD' report period used everywhere downstream.
        stock_output_y.columns = [str(c)[:10] for c in stock_output_y.columns]

        # Per-share cash dividend (HKD) lives on the main indicator report as
        # DPS_HKD; keep a {period -> value} map for the dividend-row builder.
        try:
            if 'DPS_HKD' in df_income_stock.columns:
                for idx, val in df_income_stock['DPS_HKD'].items():
                    dps_map[str(idx)[:10]] = val
        except Exception:  # noqa: BLE001
            pass

        # Report-type per period, used downstream to split annual (001) from
        # interim/quarterly (002/003/004) columns.
        try:
            if 'DATE_TYPE_CODE' in df_income_stock.columns:
                for idx, val in df_income_stock['DATE_TYPE_CODE'].items():
                    date_type_map[str(idx)[:10]] = str(val)
        except Exception:  # noqa: BLE001
            pass

        print('---------The Output Financial Report for this Stock is -----------: \n')
        print(f'{list(stock_output_y.columns)}')
        _nd = 'H{}_Notice_Date.xlsx'.format(str(stock_hk).split('.')[0])
        print('如需精确 Notice Date，请在 OneDrive Apps/StockBatchTracker/ 保存 {}（列：Notice_Date、Report_Title）。\n'.format(_nd))
        print('---------------  括号内容为必填列名 -------------\n')

        # notice_date_df = pd.DataFrame(
        #     notification_date_list, index=stock_output_y.columns, columns=['Notice Date']).T
        # stock_output_y = pd.concat([notice_date_df, stock_output_y], axis=0)

        # # df_income_stock.T.to_excel('00.in.xlsx',encoding='utf-8')
        # # df_cash_flow.T.to_excel('00.ca.xlsx',encoding='utf-8')
        # df_balance_sheet.T.to_excel('00.ba.xlsx',encoding='utf-8')
    except Exception as _e:  # noqa: BLE001
        print('Data is not available for {} in EasMon ({}).\n'.format(stock_hk, _e))
    return [stock_output_y, stock_name_from_year_income, dps_map, date_type_map]


def Dividend_Data_Yearly_from_Eas_Mon_HK(stock_hk, proxies, strict=False):
    """Fetch HK dividend *plan descriptions* from EastMoney's F10 endpoint.

    Unlike the A-share ``RPT_SHAREBONUS_DET`` feed, ``RPT_HKF10_INFO_DIVIDEND``
    only carries a textual ``PLAN_EXPLAIN`` (e.g. "特别分配 ...") plus period
    metadata — no numeric per-share amount (that comes from DPS_HKD on the main
    indicator report). It also only exists for years the company actually paid.

    Returns a list of dicts ``{'year': '2020', 'plan': '...'}`` (possibly empty).
    Never raises — a missing/empty feed just yields ``[]``.
    """
    string_v = generate_random_string(17)
    url = ('https://dat{}nter.eas{}ney.com/securities/api/data/v1/get'
           '?reportName=RPT_HKF10_INFO_DIVIDEND&columns=ALL&quoteColumns='
           '&filter=(SECUCODE%3D%22{}%22)&pageNumber=1&pageSize=50'
           '&sortTypes=-1&sortColumns=NOTICE_DATE&source=F10&client=PC&v={}'
           ).format('ace', 'tmo', stock_hk, string_v)
    try:
        try:
            resp = requests.get(url, headers=headers_easmon)
        except Exception:  # noqa: BLE001
            resp = requests.get(url, headers=headers_easmon, proxies=proxies)
        if resp.status_code != 200:
            print('Failed to retrieve HK dividend data for {}: {}\n'.format(
                stock_hk, resp.status_code))
            if strict:
                raise RuntimeError('HK dividend HTTP {}'.format(resp.status_code))
            return []
        data = resp.json().get('result')
        if not data or not data.get('data'):
            print('No HK dividend records for {}.\n'.format(stock_hk))
            return []
        out = []
        for rec in data['data']:
            period = rec.get('ASSIGN_PERIOD') or rec.get('REPORT_DATE') or ''
            year = str(period)[:4]
            # ASSIGN_PERIOD is sometimes a text label (e.g. "特别分配" for a
            # special distribution) rather than a date, which would make the
            # fiscal year "特别分配" and never match any report column. Fall back
            # to a real date field so the payout maps to its actual year.
            if not year.isdigit():
                for k in ('REPORT_DATE', 'NOTICE_DATE', 'EQUITY_RECORD_DATE',
                          'EX_DIVIDEND_DATE'):
                    v = str(rec.get(k) or '')
                    if v[:4].isdigit():
                        year = v[:4]
                        break
            plan = rec.get('PLAN_EXPLAIN')
            # RPT_HKF10_INFO_DIVIDEND carries no numeric per-share field; the
            # cash amount only exists inside PLAN_EXPLAIN text such as
            # "每股派港币0.35元". Parse it out (None when not a cash payout).
            amount = None
            if plan:
                m = re.search(r'派[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*元', str(plan))
                if m:
                    try:
                        amount = float(m.group(1))
                    except (TypeError, ValueError):
                        amount = None
            out.append({
                'year': year,
                'plan': plan,
                'amount': amount,
                'notice_date': str(rec.get('NOTICE_DATE') or '')[:10],
                'record_date': str(rec.get('EQUITY_RECORD_DATE')
                                   or rec.get('EX_DIVIDEND_DATE') or '')[:10],
            })
        return out
    except Exception as e:  # noqa: BLE001
        print('HK dividend fetch failed for {} ({}); treating as none.\n'.format(stock_hk, e))
        if strict:
            raise
        return []

################# to get the stock price for each year #####################################


def request_easmon_kline_with_retry(url, headers, proxies=None, warmup_url=None, max_retries=5, timeout=30, url_rebuild=None):
    """Request the EastMoney kline API with a warm-up + exponential backoff.

    EastMoney's historical kline host (push2his) sits behind a "checkuser" WAF:
    a bare request without the ``wsc_checkuser_ok`` cookie gets its TCP
    connection dropped, which surfaces as
    requests.exceptions.ConnectionError('RemoteDisconnected'). A real browser
    first visits the stock's concept page, which sets ``qgqp_b_id`` and
    ``wsc_checkuser_ok=1``, and only then calls the kline API.

    This helper reproduces that flow with a ``requests.Session``: it first GETs
    ``warmup_url`` (the concept page) to obtain the WAF cookies, then calls the
    kline endpoint on the same session so the cookies ride along. Each retry
    starts a fresh session and re-warms, since the cookie may expire or the
    challenge may need re-passing.

    Returns the successful Response, or None if every attempt fails.

    When ``url_rebuild`` is supplied it must be a ``callable(attempt) -> url``;
    each attempt then targets a freshly built URL (used by the HK price fetch to
    vary the kline ``lmt`` per attempt). Defaults to None -> the fixed ``url`` is
    reused every attempt, so existing callers are unaffected.
    """
    for attempt in range(1, max_retries + 1):
        if url_rebuild is not None:
            url = url_rebuild(attempt)
        try:
            session = requests.Session()
            if warmup_url:
                try:
                    warmup_headers = {
                        'User-Agent': headers.get('User-Agent', 'Mozilla/5.0'),
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                    }
                    session.get(warmup_url, headers=warmup_headers, timeout=timeout)
                    cookie_names = list(session.cookies.keys())
                    print('Warm-up GET {} -> cookies obtained: {} (checkuser_ok={})'.format(
                        warmup_url, cookie_names, session.cookies.get('wsc_checkuser_ok')))
                except requests.exceptions.RequestException as ew:
                    print('Warm-up request failed ({}: {}); proceeding without cookies.'.format(
                        type(ew).__name__, ew))
            return session.get(url, headers=headers, timeout=timeout)
        except requests.exceptions.RequestException as e:
            wait = min(30 * attempt, 120) + random.uniform(0, 15)
            print('EasMon kline request attempt {}/{} failed ({}: {}).'.format(
                attempt, max_retries, type(e).__name__, e))
            if attempt < max_retries:
                print('Backing off for {:.0f}s before retrying...'.format(wait))
                time.sleep(wait)
            else:
                # last resort: try once through the proxy if one is configured
                if proxies:
                    try:
                        return requests.get(url, headers=headers, proxies=proxies, timeout=timeout)
                    except requests.exceptions.RequestException as e2:
                        print('Proxy fallback also failed ({}: {}).'.format(
                            type(e2).__name__, e2))
                print('EasMon kline request permanently failed after {} attempts; skipping.'.format(
                    max_retries))
    return None


def get_stock_price_Raw_Data_EasMon(stock_cn, proxies, limit_number='210'):
    # Generate a random UUID (version 4)
    random_uuid = uuid.uuid4()
    # Convert to string without hyphens
    ut_string = str(random_uuid).replace('-', '')
    # print('ut string used is: {}\n'.format(ut_string))

    if stock_cn.endswith(".SH"):
        stock_number = stock_cn[:6]
        stock_mkt = 1
        stock_mkt_lower_case = 'sh'
    elif stock_cn.endswith(".SZ"):
        stock_number = stock_cn[:6]
        stock_mkt = 0
        stock_mkt_lower_case = 'sz'

    headers_easmon_price_range = {
        'Host': 'push2his.eas{}ney.com'.format('tmo'),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://emweb.securities.eas{}ney.com'.format('tmo'),
        'DNT': '1',
        'Referer': 'https://quote.eas{}ney.com/concept/{}{}.html'.format('tmo', stock_mkt_lower_case, stock_number),
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
    }

    klt_code = '101'
    fqt_code = '1'

    # Get today's date and format it as YYYYMMDD
    today_str = datetime.datetime.now().strftime("%Y%m%d")

    url_price_range = 'https://pu{}.eas{}ey.com/api/qt/stock/kline/get?secid={}.{}&ut={}&fields1=f1%2Cf2%2Cf3%2Cf4%2Cf5%2Cf6&fields2=f51%2Cf52%2Cf53%2Cf54%2Cf55%2Cf56%2Cf57%2Cf58%2Cf59%2Cf60%2Cf61&klt={}&fqt={}&end={}&lmt={}&cb=quote_jp4'.format(
        'sh2his', 'tmon', stock_mkt, stock_number, ut_string, klt_code, fqt_code, today_str, limit_number)

    warmup_url = 'https://quote.eas{}ney.com/concept/{}{}.html'.format(
        'tmo', stock_mkt_lower_case, stock_number)

    response_price = request_easmon_kline_with_retry(
        url_price_range, headers_easmon_price_range, proxies=proxies, warmup_url=warmup_url)
    if response_price is not None and response_price.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Price Range.\n'.format(stock_cn))
        # Remove the JSONP wrapper
        start_index = response_price.text.find('(') + 1
        end_index = response_price.text.rfind(');')
        json_data = response_price.text[start_index:end_index]

        # Parse the JSON string into a Python dictionary
        price_range_raw_data = json.loads(json_data)
        price_range_raw_data_list = price_range_raw_data['data']['klines']

        # to turn price range list into DataFrame
        columns = ["日期", "开盘", "收盘", "最高", "最低",
                   "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]
        # Split each line into components
        parsed_data = [line.split(",") for line in price_range_raw_data_list]

        # Create the DataFrame
        price_df = pd.DataFrame(parsed_data, columns=columns)

        # Convert numeric columns to appropriate data types
        numeric_columns = ["开盘", "收盘", "最高", "最低",
                           "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]
        price_df[numeric_columns] = price_df[numeric_columns].apply(
            pd.to_numeric)

        # Convert '日期' column to datetime for easier filtering
        price_df['日期'] = pd.to_datetime(price_df['日期'])

    else:
        status = response_price.status_code if response_price is not None else 'no response'
        print(
            f"Failed to retrieve data: {status} for Price Range... ")
        # to turn price range list into DataFrame
        columns = ["日期", "开盘", "收盘", "最高", "最低",
                   "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]
        parsed_data = []
        # Create the DataFrame
        price_df = pd.DataFrame(parsed_data, columns=columns)

    time.sleep(random.uniform(15, 25))
    return price_df


def get_stock_price_from_kline_text(kline_text, stock_cn=''):
    """Parse a manually-downloaded EastMoney kline response into a price DataFrame.

    The EastMoney historical kline host (push2his) is not reliably reachable from
    cloud / datacenter IPs, so the kline JSONP is downloaded in a browser and
    saved to OneDrive as ``kline/{code}.txt``. This function takes that raw file
    text and produces the exact same DataFrame that
    ``get_stock_price_Raw_Data_EasMon`` used to return from the live API.

    Accepts either the JSONP form ``quote_jp4({...});`` or bare JSON ``{...}``.
    Returns an empty (correctly-columned) DataFrame if the text is missing/blank
    or cannot be parsed.
    """
    columns = ["日期", "开盘", "收盘", "最高", "最低",
               "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]
    numeric_columns = ["开盘", "收盘", "最高", "最低",
                       "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]

    def _empty():
        return pd.DataFrame([], columns=columns)

    if not kline_text or not kline_text.strip():
        print('No kline text supplied for {}; returning empty price frame.\n'.format(stock_cn))
        return _empty()

    text = kline_text.strip()
    # Strip an optional JSONP wrapper: callback(...)  ->  ...
    if '(' in text and text.rfind(')') > text.find('('):
        start_index = text.find('(') + 1
        end_index = text.rfind(')')
        json_data = text[start_index:end_index]
    else:
        json_data = text

    try:
        price_range_raw_data = json.loads(json_data)
        price_range_raw_data_list = price_range_raw_data['data']['klines']
    except Exception as e:  # noqa: BLE001
        print('Could not parse kline text for {} ({}: {}); returning empty frame.\n'.format(
            stock_cn, type(e).__name__, e))
        return _empty()

    if not price_range_raw_data_list:
        print('Kline text for {} contained no klines; returning empty frame.\n'.format(stock_cn))
        return _empty()

    parsed_data = [line.split(",") for line in price_range_raw_data_list]
    price_df = pd.DataFrame(parsed_data, columns=columns)
    price_df[numeric_columns] = price_df[numeric_columns].apply(pd.to_numeric)
    price_df['日期'] = pd.to_datetime(price_df['日期'])
    print('Parsed {} kline rows for {} from saved file.\n'.format(len(price_df), stock_cn))
    return price_df


def get_stock_price_Raw_Data_EasMon_HK(stock_hk, proxies, limit_number='1760'):
    # Generate a random UUID (version 4)
    random_uuid = uuid.uuid4()
    # Convert to string without hyphens
    ut_string = str(random_uuid).replace('-', '')
    # print('ut string used is: {}\n'.format(ut_string))

    stock_mkt = '116'
    # stock_hk is like '01548.HK' -> secid code is the part before '.HK' ('01548').
    stock_number = str(stock_hk).split('.')[0]

    headers_easmon_price_range = {
        'Host': 'push2his.eas{}ney.com'.format('tmo'),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://emweb.securities.eas{}ney.com'.format('tmo'),
        'DNT': '1',
        'Referer': 'https://quote.eas{}ney.com/'.format('tmo'),
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
    }

    klt_code = '101'
    fqt_code = '1'

    # Get today's date and format it as YYYYMMDD
    today_str = datetime.datetime.now().strftime("%Y%m%d")

    def _build_url(attempt):
        # Attempt 1 uses the requested limit (default 1760); any retry uses a
        # fresh random lmt in [1700, 1800] and a fresh uuid, in case a specific
        # kline count trips the upstream. Retry count/backoff stay as-is (the
        # helper's max_retries=5).
        lmt = str(limit_number) if attempt == 1 else str(random.randint(1700, 1800))
        ut = str(uuid.uuid4()).replace('-', '')
        return ('https://pu{}.eas{}ey.com/api/qt/stock/kline/get?secid={}.{}&ut={}'
                '&fields1=f1%2Cf2%2Cf3%2Cf4%2Cf5%2Cf6'
                '&fields2=f51%2Cf52%2Cf53%2Cf54%2Cf55%2Cf56%2Cf57%2Cf58%2Cf59%2Cf60%2Cf61'
                '&klt={}&fqt={}&end={}&lmt={}&cb=_jp1').format(
            'sh2his', 'tmon', stock_mkt, stock_number, ut,
            klt_code, fqt_code, today_str, lmt)

    url_price_range = _build_url(1)


    response_price = request_easmon_kline_with_retry(
        url_price_range, headers_easmon_price_range, proxies=proxies,
        url_rebuild=_build_url)
    if response_price is not None and response_price.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for {} Price Range.\n'.format(stock_hk))
        # Remove the JSONP wrapper
        start_index = response_price.text.find('(') + 1
        end_index = response_price.text.rfind(');')
        json_data = response_price.text[start_index:end_index]

        # Parse the JSON string into a Python dictionary
        price_range_raw_data = json.loads(json_data)
        price_range_raw_data_list = price_range_raw_data['data']['klines']

        # to turn price range list into DataFrame
        columns = ["日期", "开盘", "收盘", "最高", "最低",
                   "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]
        # Split each line into components
        parsed_data = [line.split(",") for line in price_range_raw_data_list]

        # Create the DataFrame
        price_df = pd.DataFrame(parsed_data, columns=columns)

        # Convert numeric columns to appropriate data types
        numeric_columns = ["开盘", "收盘", "最高", "最低",
                           "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]
        price_df[numeric_columns] = price_df[numeric_columns].apply(
            pd.to_numeric)

        # Convert '日期' column to datetime for easier filtering
        price_df['日期'] = pd.to_datetime(price_df['日期'])

    else:
        status = response_price.status_code if response_price is not None else 'no response'
        print(
            f"Failed to retrieve data: {status} for Price Range... ")
        # to turn price range list into DataFrame
        columns = ["日期", "开盘", "收盘", "最高", "最低",
                   "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]
        parsed_data = []
        # Create the DataFrame
        price_df = pd.DataFrame(parsed_data, columns=columns)

    time.sleep(random.uniform(15, 25))
    return price_df

################# to get the stock price for each year #####################################
def get_stock_price_range_Based_on_EasMon(stock_price_df, stock_output, day_one):
    time_list = list(stock_output.loc['Notice Date'])

    # to turn the report notification date into 2024-09-30 format ###
    stock_price_temp = []

    for i in range(0, len(time_list)):
        if i == 0:
            end_date = day_one.strftime('%Y-%m-%d')
            start_date = time_list[i]
        else:
            end_date = time_list[i-1]
            start_date = time_list[i]

        # Convert to datetime objects
        start_date = pd.to_datetime(start_date)
        end_date = pd.to_datetime(end_date)
        # Filter the DataFrame for the date range
        filtered_df = stock_price_df[(stock_price_df['日期'] >= start_date) & (
            stock_price_df['日期'] <= end_date)]
        stock_price_high_low = '{:.2f}'.format(
            filtered_df['收盘'].min()) + '-' + '{:.2f}'.format(filtered_df['收盘'].max())
        stock_price_temp.append(stock_price_high_low)
    stock_price_output = pd.DataFrame([stock_price_temp])
    stock_price_output.columns = list(stock_output.columns)

    stock_price_output = stock_price_output.rename(index={0: '后一年股价范围'})
    return stock_price_output

### to get the latest 7days(10actually) stock price #################################


def get_latest_7_days_stock_price_Based_on_EasMon(stock_price_df, proxy_add):
    last_7_days_end = datetime.datetime.now().strftime('%Y-%m-%d')
    last_7_days_start = (datetime.datetime.now() -
                         datetime.timedelta(days=10)).strftime('%Y-%m-%d')

    # Convert to datetime objects
    start_date = pd.to_datetime(last_7_days_start)
    end_date = pd.to_datetime(last_7_days_end)
    # Filter the DataFrame for the date range
    filtered_df = stock_price_df[(stock_price_df['日期'] >= start_date) & (
        stock_price_df['日期'] <= end_date)]
    last_7_days_stock_price_high_low = '{:.2f}'.format(
        filtered_df['收盘'].min()) + '-' + '{:.2f}'.format(filtered_df['收盘'].max())

    return last_7_days_stock_price_high_low


################# to get the stock price for each year #####################################
def get_stock_price_range(stock_output, stock, day_one, proxy_add):
    time_list = list(stock_output.loc['Notice Date'])

    # to turn the report notification date into 2024-09-30 format ###

    stock_price_temp = []
    stock_target = yf.Ticker(stock)

    for i in range(0, len(time_list)):
        if i == 0:
            stock_price = stock_target.history(end=day_one.strftime(
                '%Y-%m-%d'), start=time_list[i], proxy=proxy_add)
        else:
            stock_price = stock_target.history(
                end=time_list[i-1], start=time_list[i], proxy=proxy_add)
        time.sleep(15)

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
    time.sleep(15)
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
        # create a file file for this data:
        endpoint_create_file = 'https://graph.microsoft.com/v1.0/users/' + \
            '{}/drive/items/{}:/{}-Y-{}.pkl:/content'.format(
                user_id, parent_id, stock, stock_name)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                                    'Accept': 'application/json',
                                    'Content-Type': 'text/plain'}
        try:
            data_create_file = requests.put(
                endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_create_file = requests.put(
                endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False, proxies=proxies)
        print('Uploaded Yearly data  to Created New file: status code is: {}----\n'.format(
            data_create_file.status_code))
        if data_create_file.status_code == 201:
            print('Yearly Data file uploaded to OneDrive Successfully!-------- \n')
    os.remove('{}-Y-{}.pkl'.format(stock, stock_name))

### below is to store monthly data to OneDrive ###


def save_monthly_data_to_OneDrive_newFile(stock_name, stock_data, stock, user_id, parent_id, result, proxies):
    stock_data.to_pickle('{}-M-{}_monthly.pkl'.format(stock, stock_name))

    # 打开一个二进制文件进行读取
    with open('{}-M-{}_monthly.pkl'.format(stock, stock_name), 'rb') as filedata:
        # create a file file for this data:
        endpoint_create_file = 'https://graph.microsoft.com/v1.0/users/' + \
            '{}/drive/items/{}:/{}-M-{}_monthly.pkl:/content'.format(
                user_id, parent_id, stock, stock_name)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                                    'Accept': 'application/json',
                                    'Content-Type': 'text/plain'}
        try:
            data_create_file = requests.put(
                endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_create_file = requests.put(
                endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False, proxies=proxies)
        print('Updated Monthly data file: status code is: {}----\n'.format(data_create_file.status_code))
        if data_create_file.status_code == 201:
            print('Monthly Data file uploaded to OneDrive Successfully!-------- \n')
    os.remove('{}-M-{}_monthly.pkl'.format(stock, stock_name))

### Define a update existing file to OneDrive Function ##############


def update_data_in_OneDrive(stock_name, stock_data, stock, user_id, data_file_id, result, proxies):
    stock_data.to_pickle('{}-Y-{}.pkl'.format(stock, stock_name))

    # 打开一个二进制文件进行读取
    with open('{}-Y-{}.pkl'.format(stock, stock_name), 'rb') as filedata:
        # create a file file for this data:
        # endpoint_update_file = 'https://graph.microsoft.com/v1.0/users/' + '{}/drive/items/{}/content'.format(user_id,data_file_id,stock)
        endpoint_update_file = 'https://graph.microsoft.com/v1.0/users/' + \
            '{}/drive/items/{}/content'.format(user_id, data_file_id)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                                    'Accept': 'application/json',
                                    'Content-Type': 'text/plain'}
        try:
            data_update_file = requests.put(
                endpoint_update_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_update_file = requests.put(
                endpoint_update_file, headers=http_headers_create_file, data=filedata, stream=False, proxies=proxies)
        print('Updated Yearly data file: status code is: {}----\n'.format(data_update_file.status_code))
        if data_update_file.status_code == 201:
            print('Yearly Data file updated to OneDrive Successfully!-------- \n')
    os.remove('{}-Y-{}.pkl'.format(stock, stock_name))

### to update existing monthly data file to OneDrive Function ###


def update_monthly_data_in_OneDrive(stock_name, stock_data, stock, user_id, data_file_id, result, proxies):
    stock_data.to_pickle('{}-M-{}_monthly.pkl'.format(stock, stock_name))

    # 打开一个二进制文件进行读取
    with open('{}-M-{}_monthly.pkl'.format(stock, stock_name), 'rb') as filedata:
        # create a file file for this data:
        endpoint_update_file = 'https://graph.microsoft.com/v1.0/users/' + \
            '{}/drive/items/{}/content'.format(user_id, data_file_id, stock)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                                    'Accept': 'application/json',
                                    'Content-Type': 'text/plain'}
        try:
            data_update_file = requests.put(
                endpoint_update_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_update_file = requests.put(
                endpoint_update_file, headers=http_headers_create_file, data=filedata, stream=False, proxies=proxies)
        print('Updated Monthly data file: status code is: {}----\n'.format(data_update_file.status_code))
        if data_update_file.status_code == 201:
            print('Monthly Data file updated to OneDrive Successfully!-------- \n')
    os.remove('{}-M-{}_monthly.pkl'.format(stock, stock_name))

### Define a Save New file to OneDrive Function ##############


def Save_File_To_OneDrive(file, user_id, parent_id, result, proxies):
    # 打开一个二进制文件进行读取
    with open(file, 'rb') as filedata:
        # create a file file for this data:
        endpoint_create_file = 'https://graph.microsoft.com/v1.0/users/' + \
            '{}/drive/items/{}:/{}:/content'.format(user_id, parent_id, file)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                                    'Accept': 'application/json',
                                    'Content-Type': 'text/plain'}
        try:
            data_save_file = requests.put(
                endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_save_file = requests.put(
                endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False, proxies=proxies)
        print('File Saved to OneDrive: status code is: {}----\n'.format(data_save_file.status_code))
        if data_save_file.status_code == 201:
            print('Data file Saved to OneDrive Successfully!-------- \n')
    os.remove(file)


### Define the function for Ford Stock ##############################
def get_stock_info_for_F(stock, proxy_add):
    ### 以下是对一只股票进行查询 ###
    stock_target = yf.Ticker(stock)
    stock_target_sales = stock_target.get_cashflow(
        freq='yearly', proxy=proxy_add)
    time.sleep(15)
    stock_target_balance_sheet = stock_target.get_balance_sheet(
        freq='yearly', proxy=proxy_add)
    time.sleep(15)
    stock_target_income = stock_target.get_income_stmt(
        freq='yearly', proxy=proxy_add)
    time.sleep(15)

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
            # 流动资产与流动负债之比 应>2
            'CurrentAssets']/stock_target_balance_sheet.loc['CurrentLiabilities']
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
    stock_output = stock_output.T.astype('float64').round(2)

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
        print('{} - {} - stock price range is: {}\n'.format(str(int(
            time_list[i])+1) + '-02-02', str(int(time_list[i])+2) + '-02-01', stock_price_high_low))
    stock_price_output = pd.DataFrame([stock_price_temp])
    stock_price_output.columns = duration
    stock_price_output = stock_price_output.rename(index={0: '后一年股价范围'})

    stock_output_combined = pd.concat(
        [stock_output, stock_price_output], axis=0)
    stock_name_for_F = 'Ford'

    return [stock_output_combined, stock_name_for_F]


################# To Get SH-SZ 300 Stock List ################
def get_SH_SZ_300_list_from_eas_mon():
    url_300_stock_list = 'https://dat{}ter-web.eas{}ey.com/api/data/v1/get?sortColumns=SECURITY_CODE&sortTypes=-1&pageSize={}&pageNumber=1&reportName={}&columns=SECUCODE%2CSECURITY_CODE%2CTYPE%2CSECURITY_NAME_ABBR%2CCLOSE_PRICE%2CINDUSTRY%2CREGION%2CWEIGHT%2CEPS%2CBPS%2CROE%2CTOTAL_SHARES%2CFREE_SHARES%2CFREE_CAP&quoteColumns=f2%2Cf3&quoteType=0&source=WEB&client=WEB&filter=(TYPE%3D%22{}%22)'.format(
        'acen', 'tmon', '320', 'RPT_INDEX_TS_COMPONENT', '1')
    try:
        response_sh_sz_300 = requests.get(
            url_300_stock_list, headers=headers_easmon_stock_list)
    except:
        response_sh_sz_300 = requests.get(
            url_300_stock_list, headers=headers_easmon_stock_list)
    if response_sh_sz_300.status_code == 200:
        # Process the response data here
        print('Got the response from Eas Mon for  SH_SZ_300_List ...\n')
        pass
    else:
        print(f"Failed to retrieve data: {response_sh_sz_300.status_code}")
    response_sh_sz_300_list = response_sh_sz_300.json()['result']['data']
    response_sh_sz_300_df = pd.DataFrame(response_sh_sz_300_list)
    response_sh_sz_300_df.set_index('SECURITY_CODE', inplace=True)
    time.sleep(random.uniform(15, 25))
    return response_sh_sz_300_df


################# To Get All SH-SZ Stock List ################
def get_SH_SZ_All_list_from_eas_mon():
    page_number = 1
    response_sh_sz_all_list = []
    while page_number <= 11:
        url_all_stock_list = 'https://dat{}ter-web.eas{}ey.com/api/data/v1/get?sortColumns=UPDATE_DATE%2CSECURITY_CODE&sortTypes=-1%2C-1&pageSize={}&pageNumber={}&reportName={}&columns=ALL&filter=(SECURITY_TYPE_CODE+in+(%22{}%22%2C%22{}%22))(TRADE_MARKET_CODE!%3D%22{}%22)(REPORTDATE%3D%27{}-12-31%27)'.format(
            'acen', 'tmon', '500', page_number, 'RPT_LICO_FN_CPD', '058001001', '058001008', '069001017', '2024')
        try:
            response_sh_sz = requests.get(
                url_all_stock_list, headers=headers_easmon_stock_list)
        except:
            response_sh_sz = requests.get(
                url_all_stock_list, headers=headers_easmon_stock_list)
        if response_sh_sz.status_code == 200:
            # Process the response data here
            print(
                'page {} - Got the response from Eas Mon for  SH_SZ_All_List ...\n'.format(page_number))
            pass
        else:
            print(
                f"page {page_number} - Failed to retrieve data: {response_sh_sz.status_code}")
        response_sh_sz_list = response_sh_sz.json()['result']['data']
        response_sh_sz_all_list.extend(response_sh_sz_list)
        time.sleep(random.uniform(15, 25))
        page_number = page_number + 1
    response_sh_sz_all_df = pd.DataFrame(response_sh_sz_all_list)
    response_sh_sz_all_df.set_index('SECURITY_CODE', inplace=True)
    return response_sh_sz_all_df


def save_Notice_Date_data_to_OneDrive_newFile(stock_code, stock_data, user_id, parent_id, result, proxies):
    stock_data.to_pickle('{}-Notice_Date.pkl'.format(stock_code))

    # 打开一个二进制文件进行读取
    with open('{}-Notice_Date.pkl'.format(stock_code), 'rb') as filedata:
        # create a file file for this data:
        endpoint_create_file = 'https://graph.microsoft.com/v1.0/users/' + \
            '{}/drive/items/{}:/{}-Notice_Date.pkl:/content'.format(
                user_id, parent_id, stock_code)
        http_headers_create_file = {'Authorization': 'Bearer ' + result['access_token'],
                                    'Accept': 'application/json',
                                    'Content-Type': 'text/plain'}
        try:
            data_create_file = requests.put(
                endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False)
        except:
            data_create_file = requests.put(
                endpoint_create_file, headers=http_headers_create_file, data=filedata, stream=False, proxies=proxies)
        print('Updated Notice Date data file: status code is: {}----\n'.format(data_create_file.status_code))
        if data_create_file.status_code == 201:
            print('Notice Date file uploaded to OneDrive Successfully!-------- \n')
    os.remove('{}-Notice_Date.pkl'.format(stock_code))


# ==========================================================================
# 筹码分布 (chip distribution / CYQ) — fully automated via Tencent quotes.
#
# EastMoney's kline host (push2his) is WAF-blocked from cloud IPs, so we source
# daily OHLC+volume from Tencent (web.ifzq.gtimg.cn) — cloud-reachable, no WAF,
# covers A-shares AND HK — and the free-float share count from the Tencent
# snapshot (qt.gtimg.cn). We then run EastMoney's OFFICIAL chip-distribution
# algorithm (ported from akshare's embedded CYQCalculator JS: triangular
# distribution + per-day turnover decay, window=240 days ≈1年交易日, factor=150
# price levels) to produce the histogram plus 获利比例 / 平均成本 / 90-70 成本区间 / 集中度.
# (akshare's embedded JS defaults range=120; we use 240 to match broker/腾讯 App
# 一年口径 — e.g. 600741 avg cost then matches 腾讯不复权 18.26 / 中信 18.4.)
#
# Per-day turnover% is approximated as volume(shares) / free_float_shares * 100
# using the current float (float changes slowly, standard approximation when the
# source lacks a historical per-day turnover field).
# ==========================================================================

def _to_tencent_secid(stock_cn):
    """Map our stock code to a Tencent quote symbol.
    '600519.SH'->'sh600519', '000001.SZ'->'sz000001', '01548.HK'->'hk01548'."""
    s = str(stock_cn).strip()
    if s.endswith('.HK'):
        return 'hk' + s.split('.')[0].zfill(5)
    if s.endswith('.SH') or s.endswith('.ss'):
        return 'sh' + s[:6]
    if s.endswith('.SZ') or s.endswith('.sz'):
        return 'sz' + s[:6]
    # bare 6-digit fallback: 6xxxxx -> SH else SZ
    digits = ''.join(ch for ch in s if ch.isdigit())[:6]
    if not digits:
        return None
    return ('sh' if digits.startswith('6') else 'sz') + digits


def fetch_tencent_daily(tx_secid, n=130, proxies=None):
    """Fetch ~n most-recent daily candles from Tencent.
    Returns a DataFrame [date, open, close, high, low, volume] (volume in 手/lots,
    HK in shares) sorted oldest->newest, or an empty DataFrame on failure."""
    cols = ['date', 'open', 'close', 'high', 'low', 'volume']
    url = ('https://web.ifzq.gtimg.com/appstock/app/kline/kline'
           '?param={},day,,,{}'.format(tx_secid, int(n)))
    # host has two spellings; ifzq.gtimg.cn is the canonical one
    url = url.replace('gtimg.com', 'gtimg.cn')
    try:
        r = requests.get(url, timeout=30)
    except requests.exceptions.RequestException:
        try:
            r = requests.get(url, timeout=30, proxies=proxies)
        except requests.exceptions.RequestException as e:
            print('Tencent daily fetch failed for {} ({}: {}).\n'.format(
                tx_secid, type(e).__name__, e))
            return pd.DataFrame([], columns=cols)
    try:
        data = r.json()['data'][tx_secid]
        rows = data.get('day') or data.get('qfqday') or []
    except Exception as e:  # noqa: BLE001
        print('Tencent daily parse failed for {} ({}: {}).\n'.format(
            tx_secid, type(e).__name__, e))
        return pd.DataFrame([], columns=cols)
    if not rows:
        return pd.DataFrame([], columns=cols)
    parsed = [[c[0], float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[5])]
              for c in rows if len(c) >= 6]
    out = pd.DataFrame(parsed, columns=cols)
    return out


def tencent_daily_to_price_df(daily_df):
    """Convert Tencent's compact daily frame to the batch's canonical columns."""
    columns = ["日期", "开盘", "收盘", "最高", "最低",
               "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]
    numeric_columns = columns[1:]
    if daily_df is None or len(daily_df) == 0:
        return pd.DataFrame([], columns=columns)
    out = pd.DataFrame({
        '日期': daily_df['date'], '开盘': daily_df['open'],
        '收盘': daily_df['close'], '最高': daily_df['high'],
        '最低': daily_df['low'], '成交量只': daily_df['volume'],
    })
    for col in columns:
        if col not in out.columns:
            out[col] = pd.NA
    out = out[columns]
    out[numeric_columns] = out[numeric_columns].apply(pd.to_numeric, errors='coerce')
    out['日期'] = pd.to_datetime(out['日期'], errors='coerce')
    return out.dropna(subset=['日期']).sort_values('日期').reset_index(drop=True)


def get_recent_stock_price_from_tencent(stock_cn, proxies=None, n=300):
    """Fetch the most-recent unadjusted candles in the canonical price format."""
    secid = _to_tencent_secid(stock_cn)
    if not secid:
        return tencent_daily_to_price_df(None)
    return tencent_daily_to_price_df(fetch_tencent_daily(secid, n=n, proxies=proxies))


def get_stock_price_from_tencent(stock_cn, proxies=None, start='2018-01-01'):
    """Fully-automated replacement for the manually-downloaded kline file.

    Fetches UNADJUSTED (不复权 / 真实除权价) daily candles from Tencent
    (cloud-reachable, no WAF; covers A-shares AND HK). Unadjusted = the actual
    traded price each day (what brokers like 中信证券 show), which matches the
    price basis used by the chip-distribution computation. Returns a DataFrame
    with the SAME Chinese column layout that ``get_stock_price_from_kline_text``
    produced, so all downstream consumers (price ranges, last-10-day high/low)
    work unchanged.

    Only 日期/开盘/收盘/最高/最低/成交量只 are populated (the only columns the
    batch consumes); the remaining legacy columns are filled with NaN. Returns an
    empty (correctly-columned) DataFrame on any failure — same contract as the
    old kline parser, so the caller's ``len(df) > 0`` guard still applies.
    """
    columns = ["日期", "开盘", "收盘", "最高", "最低",
               "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]
    numeric_columns = ["开盘", "收盘", "最高", "最低",
                       "成交量只", "成交额元", "振幅", "涨跌幅%", "涨跌额", "换手率%"]

    def _empty():
        return pd.DataFrame([], columns=columns)

    secid = _to_tencent_secid(stock_cn)
    if not secid:
        print('Could not map {} to a Tencent secid; no price data.\n'.format(stock_cn))
        return _empty()

    # Tencent's kline endpoint caps a single response at ~640 trading days
    # regardless of the requested count, so we page through the history in
    # fixed date windows (start..today) and concatenate. ~2-year windows keep
    # each request comfortably under the cap. We use the UNADJUSTED (day) kline
    # endpoint (kline/kline) so prices are the real traded/除权 prices.
    today = datetime.datetime.now()
    try:
        start_year = int(str(start)[:4])
    except (ValueError, TypeError):
        start_year = 2018
    all_rows = []
    seen = set()
    win_start = datetime.datetime(start_year, 1, 1)
    step_days = 640            # ~2.5 trading years; safely under the cap
    while win_start <= today:
        win_end = min(win_start + datetime.timedelta(days=step_days), today)
        s = win_start.strftime('%Y-%m-%d')
        e = win_end.strftime('%Y-%m-%d')
        url = ('https://web.ifzq.gtimg.cn/appstock/app/kline/kline'
               '?param={},day,{},{},640'.format(secid, s, e))
        try:
            r = requests.get(url, timeout=30)
        except requests.exceptions.RequestException:
            try:
                r = requests.get(url, timeout=30, proxies=proxies)
            except requests.exceptions.RequestException as ex:
                print('Tencent day window {}..{} failed for {} ({}: {}).\n'.format(
                    s, e, stock_cn, type(ex).__name__, ex))
                win_start = win_end + datetime.timedelta(days=1)
                continue
        try:
            data = r.json().get('data') or {}
            node = data.get(secid) if isinstance(data, dict) else None
            rows = (node.get('day') or node.get('qfqday') or []) if node else []
        except Exception as ex:  # noqa: BLE001
            print('Tencent day window {}..{} parse failed for {} ({}: {}).\n'.format(
                s, e, stock_cn, type(ex).__name__, ex))
            rows = []
        for c in rows:
            if len(c) >= 6 and c[0] not in seen:
                seen.add(c[0])
                all_rows.append(c)
        win_start = win_end + datetime.timedelta(days=1)

    if not all_rows:
        print('Tencent returned no candles for {} ({}).\n'.format(stock_cn, secid))
        return _empty()

    recs = []
    for c in all_rows:
        # c = [date, open, close, high, low, volume, (optional dividend dict)]
        recs.append({
            '日期': c[0], '开盘': c[1], '收盘': c[2],
            '最高': c[3], '最低': c[4], '成交量只': c[5],
        })
    price_df = pd.DataFrame(recs)
    for col in columns:
        if col not in price_df.columns:
            price_df[col] = pd.NA
    price_df = price_df[columns]
    price_df[numeric_columns] = price_df[numeric_columns].apply(
        pd.to_numeric, errors='coerce')
    price_df['日期'] = pd.to_datetime(price_df['日期'], errors='coerce')
    price_df = price_df.dropna(subset=['日期']).sort_values('日期').reset_index(drop=True)
    print('Fetched {} Tencent day (unadjusted) rows for {} ({}).\n'.format(
        len(price_df), stock_cn, secid))
    return price_df


def fetch_tencent_float_shares(tx_secid, proxies=None):
    """Return free-float share count from the Tencent snapshot (qt.gtimg.cn),
    or None on failure.

    Snapshot is a '~'-delimited string. Field layout (0-based):
      idx 3  = current price
      idx 45 = 流通市值 in 亿 (100M units) — present for BOTH A-shares and HK
    We derive float shares = 流通市值 * 1e8 / price, which works uniformly across
    A-share and HK snapshots (their raw share-count fields sit at different
    indices). Cross-checked: 600519 -> ~1.25e9, 000001 -> ~1.94e10, 01548.HK
    -> ~2.19e9, all matching known free-float counts.
    """
    url = 'https://qt.gtimg.cn/q={}'.format(tx_secid)
    try:
        r = requests.get(url, timeout=20)
    except requests.exceptions.RequestException:
        try:
            r = requests.get(url, timeout=20, proxies=proxies)
        except requests.exceptions.RequestException as e:
            print('Tencent snapshot fetch failed for {} ({}: {}).\n'.format(
                tx_secid, type(e).__name__, e))
            return None
    try:
        txt = r.content.decode('gbk', errors='replace')
        body = txt.split('"', 2)[1]
        parts = body.split('~')
        price = float(parts[3])
        float_mktcap_yi = float(parts[45])   # 流通市值, 单位: 亿
        if price > 0 and float_mktcap_yi > 0:
            return float_mktcap_yi * 1e8 / price
    except Exception as e:  # noqa: BLE001
        print('Tencent snapshot parse failed for {} ({}: {}).\n'.format(
            tx_secid, type(e).__name__, e))
    return None


def compute_chip_distribution(daily_df, float_shares, is_hk=False,
                              window=240, factor=150):
    """Port of EastMoney's official CYQCalculator (from akshare) — triangular
    chip distribution with per-day turnover decay — over the last `window` days.

    daily_df: DataFrame with columns date/open/close/high/low/volume (oldest->newest).
    float_shares: free-float share count (for turnover% = volume_shares/float*100).
    is_hk: Tencent HK volume is already in shares; A-share volume is in 手 (×100).

    Returns a dict:
      {prices, weights, avg_cost, profit_ratio,
       cost_90_low, cost_90_high, concentration_90,
       cost_70_low, cost_70_high, concentration_70,
       latest_close, as_of}
    or None if there isn't enough data.
    """
    if daily_df is None or len(daily_df) < 2 or not float_shares or float_shares <= 0:
        return None
    df_w = daily_df.tail(window).reset_index(drop=True)
    highs = df_w['high'].tolist()
    lows = df_w['low'].tolist()
    opens = df_w['open'].tolist()
    closes = df_w['close'].tolist()
    vols = df_w['volume'].tolist()
    share_mult = 1.0 if is_hk else 100.0  # 手 -> shares for A-shares

    maxprice = max(highs)
    minprice = min(lows)
    if maxprice <= minprice:
        return None
    accuracy = max(0.01, (maxprice - minprice) / (factor - 1))
    yrange = [round(minprice + accuracy * i, 4) for i in range(factor)]
    xdata = [0.0] * factor

    for i in range(len(df_w)):
        o, c, h, low = opens[i], closes[i], highs[i], lows[i]
        avg = (o + c + h + low) / 4.0
        vol_shares = vols[i] * share_mult
        turnover = vol_shares / float_shares          # fraction (0..1-ish)
        if turnover > 1:
            turnover = 1.0
        if turnover < 0:
            turnover = 0.0
        H = int((h - minprice) // accuracy)
        L = int(-(-(low - minprice) // accuracy))     # ceil
        # peak height so triangle area == 1 before turnover scaling
        gp_h = (factor - 1) if h == low else (2.0 / (h - low))
        gp_idx = int((avg - minprice) // accuracy)
        # decay all existing chips by (1 - turnover)
        decay = (1 - turnover)
        for n in range(factor):
            xdata[n] *= decay
        if h == low:
            if 0 <= gp_idx < factor:
                xdata[gp_idx] += gp_h * turnover / 2.0
        else:
            for j in range(max(0, L), min(factor - 1, H) + 1):
                curprice = minprice + accuracy * j
                if curprice <= avg:
                    if abs(avg - low) < 1e-8:
                        xdata[j] += gp_h * turnover
                    else:
                        xdata[j] += (curprice - low) / (avg - low) * gp_h * turnover
                else:
                    if abs(h - avg) < 1e-8:
                        xdata[j] += gp_h * turnover
                    else:
                        xdata[j] += (h - curprice) / (h - avg) * gp_h * turnover

    total = sum(xdata)
    if total <= 0:
        return None
    current = closes[-1]

    def cost_by_chip(chip):
        s = 0.0
        for i in range(factor):
            if s + xdata[i] > chip:
                return minprice + i * accuracy
            s += xdata[i]
        return minprice + (factor - 1) * accuracy

    below = sum(xdata[i] for i in range(factor)
                if current >= minprice + i * accuracy)
    profit_ratio = below / total

    def pct_range(pct):
        lo = cost_by_chip(total * (1 - pct) / 2.0)
        hi = cost_by_chip(total * (1 + pct) / 2.0)
        conc = 0.0 if (lo + hi) == 0 else (hi - lo) / (lo + hi)
        return round(lo, 2), round(hi, 2), round(conc, 4)

    c90_lo, c90_hi, c90_con = pct_range(0.9)
    c70_lo, c70_hi, c70_con = pct_range(0.7)
    weights = [round(x / total, 6) for x in xdata]  # normalized to sum 1

    return {
        'prices': yrange,
        'weights': weights,
        'avg_cost': round(cost_by_chip(total * 0.5), 2),
        'profit_ratio': round(profit_ratio, 4),
        'cost_90_low': c90_lo, 'cost_90_high': c90_hi, 'concentration_90': c90_con,
        'cost_70_low': c70_lo, 'cost_70_high': c70_hi, 'concentration_70': c70_con,
        'latest_close': round(current, 2),
        'as_of': str(df_w['date'].iloc[-1]),
    }


def get_chip_distribution(stock_cn, proxies=None, is_hk=False):
    """High-level: fetch Tencent daily + float, compute chip distribution.
    Returns the dict from compute_chip_distribution, or None on any failure."""
    price_df = get_recent_stock_price_from_tencent(stock_cn, proxies=proxies, n=300)
    return get_chip_distribution_from_price_df(
        stock_cn, price_df, proxies=proxies, is_hk=is_hk)


def get_chip_distribution_from_price_df(stock_cn, stock_price_df, proxies=None,
                                         is_hk=False):
    """Compute CYQ from an already-fetched canonical price frame."""
    secid = _to_tencent_secid(stock_cn)
    if not secid or stock_price_df is None or len(stock_price_df) < 2:
        print('No Tencent daily data for {}; skipping chip distribution.\n'.format(stock_cn))
        return None
    float_shares = fetch_tencent_float_shares(secid, proxies=proxies)
    if not float_shares:
        print('No float shares for {} ({}); skipping chip distribution.\n'
              .format(stock_cn, secid))
        return None
    try:
        daily = pd.DataFrame({
            'date': pd.to_datetime(stock_price_df['日期'], errors='coerce').dt.strftime('%Y-%m-%d'),
            'open': stock_price_df['开盘'],
            'close': stock_price_df['收盘'], 'high': stock_price_df['最高'],
            'low': stock_price_df['最低'], 'volume': stock_price_df['成交量只'],
        }).tail(300).reset_index(drop=True)
        return compute_chip_distribution(daily, float_shares, is_hk=is_hk)
    except Exception as e:  # noqa: BLE001
        print('Chip distribution compute failed for {} ({}: {}).\n'.format(
            stock_cn, type(e).__name__, e))
        return None


if __name__ == "__main__":
    login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
    result = login_return['result']
    proxies = login_return['proxies']

    # 测试金斯瑞 (01548.HK)
    url = Year_report_url_HK(day_one, stock_hk='01548.HK')
    report = report_from_Eas_Mon_HK(url, proxies=proxies, stock_hk= '01548.HK')
    pass
