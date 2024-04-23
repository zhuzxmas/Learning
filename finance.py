# -*- coding:utf-8 -*-

import yfinance as yf
import pandas as pd
from tabulate import tabulate
import configparser, os
import time, random, datetime

# https://data.eastmoney.com/other/index/hs300.html 沪深300成分股清单
stock_code = [603369, 603019, 600845, 600809, 600660, 600600, 600519, 600436, 600406, 600332, 600219, 600111, 600085, 300628, 300124, 2304, 2179, 2050, 2049, 977, 858, 733, 661, 596, 568, 688396, 688363, 688126, 688111, 688012, 605117, 603290, 603259, 603195, 601138, 600938, 301269, 300957, 300760, 300661, 2920, 603993, 601985, 601919, 601899, 601898, 601857, 601800, 601699]

stock_name = ['今世缘', '中科曙光', '宝信软件', '山西汾酒', '福耀玻璃', '青岛啤酒', '贵州茅台', '片仔癀', '国电南瑞', '白云山', '南山铝业', '北方稀土', '同仁堂', '亿联网络', '汇川技术', '洋河股份', '中航光电', '三花智控', '紫光国微', '浪潮信息', '五粮液', '振华科技', '长春高新', '古井贡酒', '泸州老窖', '华润微', '华熙生物', '沪硅产业', '金山办公', '中微公司', '德业股份', '斯达半导', '药明康德', '公牛集团', '工业富联', '中国海油', '华大九天', '贝泰妮', '迈瑞医疗', '圣邦股份', '德赛西威', '洛阳钼业', '中国核电', '中远海控', '紫金矿业', '中煤能源', '中国石油', '中国交建', '潞安环能']


config = configparser.ConfigParser()
if os.path.exists('./config.cfg'): # to check if local file config.cfg is available, for local running application
    config.read(['config.cfg'])
    proxy_settings = config['proxy_add']
    if os.getlogin() == 'cindy.rao':
        proxy_add = None
    else:
        proxy_add = proxy_settings['proxy_add']
else:
    proxy_add = None

# config.read(['config1.cfg'])
# stock_settings = config['stock_name']
# stock = stock_settings['stock_name']

stock_Top_list = []
stock_Top_list_columns = ['Stock Number', '利润表现好', '流动负债不高', '分红多']

for iii in range(0,len(stock_code)): #在所有的沪深300成分股里面进行查询
# for iii in range(5,7):
    stock_Top_temp = []
    if len(str(stock_code[iii])) == 6:
        if str(stock_code[iii])[0] == '6': # SH stock
            stock = str(stock_code[iii]) + '.ss' # SH stock
        else:
            stock = str(stock_code[iii]) + '.sz' # SZ stock
    else:
        len_temp = 6 - len(str(stock_code[iii]))
        prefix = ''
        for ii in range(0,len_temp):
            prefix = prefix + '0'
        stock = prefix + str(stock_code[iii]) + '.sz'  # SZ stock

    stock_Top_temp.append('{}--{}-{}'.format(iii, stock, stock_name[iii]))

    ### 以下是对一只股票进行查询 ###
    stock_target = yf.Ticker(stock)
    stock_target_sales = stock_target.get_cashflow(freq='yearly',proxy=proxy_add)
    stock_target_balance_sheet = stock_target.get_balance_sheet(freq='yearly',proxy=proxy_add)
    stock_target_income = stock_target.get_income_stmt(freq='yearly',proxy=proxy_add)

    if 'EBIT' in stock_target_income.index and 'CurrentAssets' in stock_target_balance_sheet.index  and 'TotalRevenue' in stock_target_income.index  and 'TotalAssets' in stock_target_balance_sheet.index  and 'CurrentLiabilities' in stock_target_balance_sheet.index and 'TotalNonCurrentLiabilitiesNetMinorityInterest' in stock_target_balance_sheet.index and 'DilutedEPS' in stock_target_income.index and 'OtherIntangibleAssets' in stock_target_balance_sheet.index and 'TotalLiabilitiesNetMinorityInterest' in stock_target_balance_sheet.index and 'OrdinarySharesNumber' in stock_target_balance_sheet.index:
        print('--------Begin of this one : ↓ ↓ ↓ ↓ ↓  ---------------------\n')

        ### How Big The Company Is ###
        stock_0_TotalRevenue = stock_target_income.loc['TotalRevenue']/100000000 #销售额
        stock_0_TotalRevenue.name = '销售额 亿元'
        stock_0_TotalAssets = stock_target_balance_sheet.loc['TotalAssets']/100000000 #总资产
        stock_0_TotalAssets.name = '总资产 亿元'
        stock_0_EBIT = stock_target_income.loc['EBIT']/100000000 #息税前利润
        stock_0_EBIT.name = '息税前利润 亿元'

        ### Profit Stability of The Company ###
        stock_0_profit_margin = stock_target_income.loc['DilutedEPS'] #每股稀释后收益，每股收益
        stock_0_profit_margin.name = '稀释后 每股收益 元'
        stock_0_profit_margin_increase = []
        for ix in range(0,len(stock_0_profit_margin)-1):
            margin_increase = round((stock_0_profit_margin.values[ix] - stock_0_profit_margin.values[ix+1])/stock_0_profit_margin.values[ix+1],2)
            stock_0_profit_margin_increase.append(margin_increase)
        stock_0_profit_margin_increase.append(1) #最后一年作为基数1
        if any(map(lambda x: x <0, stock_0_profit_margin)): # 查看利润是否有负数
            profit_margin_performance = 'xxxxxxxxx  利润 <0,  不是 一直在增长 xxxxxxx'
            stock_Top_temp.append('false')
        else:
            if any(map(lambda x: x <0, stock_0_profit_margin_increase)): # 查看利润同比去年是否有负增长
                profit_margin_performance = 'xxxxxxxxx  利润 下降  xxxxxxxxx'
                stock_Top_temp.append('false')
            else:
                profit_margin_performance = '√√√√√√√√√√  利润  Yes  最近几年一直在增长 √√√√'
                stock_Top_temp.append('true')
        stock_0_profit_margin_increase = pd.DataFrame(stock_0_profit_margin_increase).set_index(stock_0_profit_margin.index)
        stock_0_profit_margin_increase = stock_0_profit_margin_increase.T.set_index([['每股利润增长率 x 100%']])
        stock_0_profit_margin_increase = stock_0_profit_margin_increase.T

        ### How Well The Company Financial Status is ###
        stock_0_CurrentAssets = stock_target_balance_sheet.loc['CurrentAssets']/100000000 #流动资产
        stock_0_CurrentAssets.name = '流动资产 亿元'
        stock_0_CurrentLiabilities = stock_target_balance_sheet.loc['CurrentLiabilities']/100000000 #流动负债
        stock_0_CurrentLiabilities.name = '流动负债 亿元'
        stock_0_CurrentAssets_vs_Liabilities = stock_target_balance_sheet.loc['CurrentAssets']/stock_target_balance_sheet.loc['CurrentLiabilities'] #流动资产与流动负债之比 应>2
        stock_0_CurrentAssets_vs_Liabilities.name = '流动资产/流动负债>2'
        if any(map(lambda x: x <1.5, stock_0_CurrentAssets_vs_Liabilities)): # 查看流动资产/流动负债是否 <1.5
            CurrentAssets_vs_Liabilities_performance = 'xxxxxxxxx 流动负债过高 xxxxxxxxx'
            stock_Top_temp.append('false')
        else:
            CurrentAssets_vs_Liabilities_performance = '√√√√√√√√√√  流动负债 不高 √√√√√√√√√√'
            stock_Top_temp.append('true')
        stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest = stock_target_balance_sheet.loc['TotalNonCurrentLiabilitiesNetMinorityInterest']/100000000 #非流动负债合计，我认为是长期负债
        stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest.name = '非流动负债'
        stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities = stock_0_CurrentAssets - stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest # 流动资产扣除长期负债后应大于0
        stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities.name = '流动资产-长期负债>0'

        ### Dividend Records of The Company ###
        stock_0_dividends = stock_target.get_dividends(proxy=proxy_add)
        if len(stock_0_dividends) == 0:
            dividends_perofrmance = 'xxxxxxxxx  公司 无 分红记录  xxxxxxxxx'
            stock_Top_temp.append('false')
        elif len(stock_0_dividends) <7:
            dividends_perofrmance = 'xxxxxxxxx  公司分红记录较少  xxxxxxxxx'
            stock_Top_temp.append('false')
        else:
            dividends_perofrmance = '√√√√√√√√√√  公司分红 很多次  √√√√√√√√√√ '
            stock_Top_temp.append('true')
        stock_Top_list.append(stock_Top_temp) #记录公司表现，利润，流动负债率，分红

        ### PE Ratio of the Company ###
        stock_PE_ratio_target = 15 # 这个是目标市盈率，股份不超过这个可以考虑入手
        stock_price_less_than_PE_ratio = stock_PE_ratio_target * stock_0_profit_margin #股份不能超过的值
        stock_price_less_than_PE_ratio.name = '市盈率15对应股价 元'

        ### Stock price vs Assets ratio ###
        stock_0_OtherIntangibleAssets = stock_target_balance_sheet.loc['OtherIntangibleAssets']/100000000 #无形资产
        stock_0_TotalLiabilitiesNetMinorityInterest = stock_target_balance_sheet.loc['TotalLiabilitiesNetMinorityInterest']/100000000 #总负债
        stock_0_OrdinarySharesNumber = stock_target_balance_sheet.loc['OrdinarySharesNumber']/1000000 #普通股数量
        stock_0_OrdinarySharesNumber.name = '普通股数量 百万'
        stock_0_BookValue = stock_0_TotalAssets - stock_0_OtherIntangibleAssets - stock_0_TotalLiabilitiesNetMinorityInterest #总账面价值
        stock_0_BookValue_per_Share = stock_0_BookValue*100000000/(stock_0_OrdinarySharesNumber*1000000) #每股账面价值
        stock_0_BookValue_per_Share.name = '每股账面价值 元'
        stock_price_less_than_BookValue_ratio = stock_0_BookValue_per_Share*1.5 #按账面价值计算出来的目标股价
        stock_price_less_than_BookValue_ratio.name = '每股账面价值1.5倍元'

        stock_output = pd.concat([stock_0_TotalRevenue, stock_0_TotalAssets, stock_0_EBIT, stock_0_CurrentAssets, stock_0_CurrentLiabilities, stock_0_CurrentAssets_vs_Liabilities, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest, stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities, stock_0_OrdinarySharesNumber,stock_0_profit_margin, stock_0_profit_margin_increase, stock_0_BookValue_per_Share, stock_price_less_than_BookValue_ratio, stock_price_less_than_PE_ratio], axis=1)
        stock_output = stock_output.T.astype('float64').round(2)
        stock_output.columns = stock_output.columns.strftime(date_format='%Y-%m-%d')

        ### To get the stock price for each year ###
        duration = stock_output.columns
        stock_price_temp = []

        time_list = []
        for i in range(0,len(duration)):
            time_list.append(duration[i].split('-')[0])
        for i in range(0,len(time_list)):
            stock_price = stock_target.history(start=str(int(time_list[i])+1)+ '-03-15',end=str(int(time_list[i])+2) + '-03-14', proxy = proxy_add)
            if stock_price.empty:
                stock_price_high_low = 'None'
                stock_price_temp.append(stock_price_high_low)
            else:
                stock_price_high_low = '{:.2f}'.format(stock_price['High'].min()) + '-' + '{:.2f}'.format(stock_price['High'].max())
                # stock_price_high_low = str(int(stock_price['High'].min())) + '-' + str(int(stock_price['High'].max()))
                stock_price_temp.append(stock_price_high_low)
        stock_price_output = pd.DataFrame([stock_price_temp])
        stock_price_output.columns = duration

        stock_price_output = stock_price_output.rename(index={0:'后一年股价范围'})
        stock_output = pd.concat([stock_output,stock_price_output],axis=0)

        last_7_days_end = datetime.datetime.now().strftime('%Y-%m-%d')
        last_7_days_start = (datetime.datetime.now()-datetime.timedelta(days=7)).strftime('%Y-%m-%d')
        last_7_days_stock_price = stock_target.history(start=last_7_days_start,end=last_7_days_end, proxy = proxy_add)
        if last_7_days_stock_price.empty:
            last_7_days_stock_price_high_low = 'None'
        else:
            last_7_days_stock_price_high_low = '{:.2f}'.format(last_7_days_stock_price['High'].min()) + '-' + '{:.2f}'.format(last_7_days_stock_price['High'].max())
            # last_7_days_stock_price_high_low = str(int(last_7_days_stock_price['High'].min())) + '-' + str(int(last_7_days_stock_price['High'].max()))

        # stock_output.to_excel('{}-Output.xlsx'.format(stock),header=1, index=1, encoding='utf_8_sig')
        print('{}--{}-{}'.format(iii, stock, stock_name[iii]),profit_margin_performance,'\n')
        print('{}--{}-{}'.format(iii, stock, stock_name[iii]),CurrentAssets_vs_Liabilities_performance,'\n')
        print('{}--{}-{}'.format(iii, stock, stock_name[iii]),dividends_perofrmance,'\n')
        print('This is the output for No. #{} ---{}: {} \n'.format(iii, stock, stock_name[iii]))
        print(tabulate(stock_output,headers='keys',tablefmt='simple'))
        print('This is the last 7 days stock price for {} {}: {} \n'.format(stock, stock_name[iii], last_7_days_stock_price_high_low))
        print('This is the dividend for {}: {} \n'.format(stock, stock_name[iii]))
        print(stock_0_dividends)
        print('--------Complete this one : ↑ ↑ ↑ ↑ ↑  ---------------------\n')
        print('                                                                                                \n')
    else:
        print('Something is missing for {} ---{}: {} \n'.format(iii, stock, stock_name[iii]))
        print('                                                                                                \n')
    time.sleep(random.uniform(7, 13))
stock_Top_list = pd.DataFrame(stock_Top_list, columns= stock_Top_list_columns).sort_values(by=['利润表现好','流动负债不高','分红多'],ascending=False)
print(tabulate(stock_Top_list,headers='keys',tablefmt='simple',))