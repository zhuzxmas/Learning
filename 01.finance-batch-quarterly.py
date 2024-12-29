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


### Define the stock list you want ###

# https://data.eastmoney.com/other/index/hs300.html 沪深300成分股清单
# stock_code = [600885, 688981, 688599, 688561, 688396, 688363, 688303, 688271, 688256, 688223, 688187, 688126, 688111, 688065, 688041, 688036, 688012, 688008, 605499, 605117, 603993, 603986, 603899, 603833, 603806, 603799, 603659, 603501, 603486, 603392, 603369, 603290, 603288, 603260, 603259, 603195, 603019, 601998, 601995, 601989, 601988, 601985, 601939, 601919, 601916, 601901, 601899, 601898, 601888, 601881, 601878, 601877, 601872, 601868, 601865, 601857, 601838, 601818, 601816, 601808, 601800, 601799, 601788, 601766, 601728, 601699, 601698, 601689, 601688, 601669, 601668, 601658, 601633, 601628, 601618, 601615, 601607, 601601, 601600, 601398, 601390, 601377, 601360, 601336, 601328, 601319, 601318, 601288, 601238, 601236, 601229, 601225, 601211, 601186, 601169, 601166, 601155, 601138, 601117, 601111, 601100, 601088, 601066, 601059, 601021, 601012, 601009, 601006, 600999, 600989, 600958, 600941, 600938, 600926, 600919, 600918, 600905, 600900, 600893, 600887, 600886, 600875, 600845, 600837, 600809, 600803, 600795, 600760, 600754, 600745, 600741, 600732, 600690, 600674, 600660, 600606, 600600, 600588, 600585, 600584, 600570, 600547, 600519, 600515, 600489, 600460, 600438, 600436, 600426, 600406, 600372, 600362, 600346, 600332, 600309, 600276, 600233, 600219, 600196, 600188, 600183, 600176, 600150, 600132, 600115, 600111, 600104, 600089, 600085, 600061, 600050, 600048, 600039, 600036, 600031, 600030, 600029, 600028, 600025, 600023, 600019, 600018, 600016, 600015, 600011, 600010, 600009, 600000, 301269, 300999, 300979, 300957, 300919, 300896, 300782, 300763, 300760, 300759, 300751, 300750, 300661, 300628, 300498, 300496, 300454, 300450, 300433, 300413, 300408, 300347, 300316, 300308, 300274, 300223, 300142, 300124, 300122, 300059, 300033, 300015, 300014, 3816, 2938, 2920, 2916, 2841, 2821, 2812, 2736, 2714, 2709, 2648, 2603, 2601, 2594, 2555, 2493, 2475, 2466, 2460, 2459, 2415, 2410, 2371, 2352, 2311, 2304, 2271, 2252, 2241, 2236, 2230, 2202, 2180, 2179, 2142, 2129, 2074, 2050, 2049, 2027, 2007, 2001, 1979, 1289, 999, 983, 977, 963, 938, 895, 877, 876, 858, 800, 792, 786, 776, 768, 733, 725, 708, 661, 651, 625, 617, 596, 568, 538, 425, 408, 338, 333, 301, 166, 157, 100, 69, 63, 'F']
stock_code = [600885, 603259, 600276, 600196, 603899, 603986, 603833, 603806, 603369, 601877, 601607, 601238, 601186, 601100, 600875, 600741, 600406, 600132, 600104, 2415, 2050, 895, 733, 661, 603288, 600845, 600690, 600660, 600600, 600332, 600085, 300628, 300124, 'F']
# stock_code = [600885, 603259, 600276]

# stock_name = ['宏发股份', '中芯国际', '天合光能', '奇安信', '华润微', '华熙生物', '大全能源', '联影医疗', '寒武纪', '晶科能源', '时代电气', '沪硅产业', '金山办公', '凯赛生物', '海光信息', '传音控股', '中微公司', '澜起科技', '东鹏饮料', '德业股份', '洛阳钼业', '兆易创新', '晨光股份', '欧派家居', '福斯特', '华友钴业', '璞泰来', '韦尔股份', '科沃斯', '万泰生物', '今世缘', '斯达半导', '海天味业', '合盛硅业', '药明康德', '公牛集团', '中科曙光', '中信银行', '中金公司', '中国重工', '中国银行', '中国核电', '建设银行', '中远海控', '浙商银行', '方正证券', '紫金矿业', '中煤能源', '中国中免', '中国银河', '浙商证券', '正泰电器', '招商轮船', '中国能建', '福莱特', '中国石油', '成都银行', '光大银行', '京沪高铁', '中海油服', '中国交建', '星宇股份', '光大证券', '中国中车', '中国电信', '潞安环能', '中国卫通', '拓普集团', '华泰证券', '中国电建', '中国建筑', '邮储银行', '长城汽车', '中国人寿', '中国中冶', '明阳智能', '上海医药', '中国太保', '中国铝业', '工商银行', '中国中铁', '兴业证券', '三六零', '新华保险', '交通银行', '中国人保', '中国平安', '农业银行', '广汽集团', '红塔证券', '上海银行', '陕西煤业', '国泰君安', '中国铁建', '北京银行', '兴业银行', '新城控股', '工业富联', '中国化学', '中国国航', '恒立液压', '中国神华', '中信建投', '信达证券', '春秋航空', '隆基绿能', '南京银行', '大秦铁路', '招商证券', '宝丰能源', '东方证券', '中国移动', '中国海油', '杭州银行', '江苏银行', '中泰证券', '三峡能源', '长江电力', '航发动力', '伊利股份', '国投电力', '东方电气', '宝信软件', '海通证券', '山西汾酒', '新奥股份', '国电电力', '中航沈飞', '锦江酒店', '闻泰科技', '华域汽车', '爱旭股份', '海尔智家', '川投能源', '福耀玻璃', '绿地控股', '青岛啤酒', '用友网络', '海螺水泥', '长电科技', '恒生电子', '山东黄金', '贵州茅台', '海南机场', '中金黄金', '士兰微', '通威股份', '片仔癀', '华鲁恒升', '国电南瑞', '中航机载', '江西铜业', '恒力石化', '白云山', '万华化学', '恒瑞医药', '圆通速递', '南山铝业', '复星医药', '兖矿能源', '生益科技', '中国巨石', '中国船舶', '重庆啤酒', '中国东航', '北方稀土', '上汽集团', '特变电工', '同仁堂', '国投资本', '中国联通', '保利发展', '四川路桥', '招商银行', '三一重工', '中信证券', '南方航空', '中国石化', '华能水电', '浙能电力', '宝钢股份', '上港集团', '民生银行', '华夏银行', '华能国际', '包钢股份', '上海机场', '浦发银行', '华大九天', '金龙鱼', '华利集团', '贝泰妮', '中伟股份', '爱美客', '卓胜微', '锦浪科技', '迈瑞医疗', '康龙化成', '迈为股份', '宁德时代', '圣邦股份', '亿联网络', '温氏股份', '中科创达', '深信服', '先导智能', '蓝思科技', '芒果超媒', '三环集团', '泰格医药', '晶盛机电', '中际旭创', '阳光电源', '北京君正', '沃森生物', '汇川技术', '智飞生物', '东方财富', '同花顺', '爱尔眼科', '亿纬锂能', '中国广核', '鹏鼎控股', '德赛西威', '深南电路', '视源股份', '凯莱英', '恩捷股份', '国信证券', '牧原股份', '天赐材料', '卫星化学', '以岭药业', '龙佰集团', '比亚迪', '三七互娱', '荣盛石化', '立讯精密', '天齐锂业', '赣锋锂业', '晶澳科技', '海康威视', '广联达', '北方华创', '顺丰控股', '海大集团', '洋河股份', '东方雨虹', '上海莱士', '歌尔股份', '大华股份', '科大讯飞', '金风科技', '纳思达', '中航光电', '宁波银行', 'TCL中环', '国轩高科', '三花智控', '紫光国微', '分众传媒', '华兰生物', '新和成', '招商蛇口', '龙源电力', '华润三九', '山西焦煤', '浪潮信息', '华东医药', '紫光股份', '双汇发展', '天山股份', '新希望', '五粮液', '一汽解放', '盐湖股份', '北新建材', '广发证券', '中航西飞', '振华科技', '京东方A', '中信特钢', '长春高新', '格力电器', '长安汽车', '中油资本', '古井贡酒', '泸州老窖', '云南白药', '徐工机械', '藏格矿业', '潍柴动力', '美的集团', '东方盛虹', '申万宏源', '中联重科', 'TCL科技', '华侨城A', '中兴通讯', 'Ford']
stock_name = ['宏发股份', '药明康德', '恒瑞医药', '复星医药', '晨光股份', '兆易创新', '欧派家居', '福斯特', '今世缘', '正泰电器', '上海医药', '广汽集团', '中国铁建', '恒立液压', '东方电气', '华域汽车', '国电南瑞', '重庆啤酒', '上汽集团', '海康威视', '三花智控', '双汇发展', '振华科技', '长春高新', '海天味业', '宝信软件', '海尔智家', '福耀玻璃', '青岛啤酒', '白云山', '同仁堂', '亿联网络', '汇川技术', 'Ford']
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
        url_eastmoney_income = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27%2C%27{}-12-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format('ace', 'tmo', p_income, p_income, stock_cn, str(int(day_one.year)-1), str(int(day_one.year)-2), str(int(day_one.year)-3), str(int(day_one.year)-4), str(int(day_one.year)-5), str(int(day_one.year)-6), str(int(day_one.year)-7), str(int(day_one.year)-8), string_v1)

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

        df_income_stock = df_income_stock.set_index('REPORT_DATE_NAME')
        df_cash_flow = df_cash_flow.set_index('REPORT_DATE_NAME')
        df_balance_sheet = df_balance_sheet.set_index('REPORT_DATE_NAME')

        quarter_mapping_income = {
            '一季度': '-03-31',
            '二季度': '-06-30',
            '三季度': '-09-30',
            '四季度': '-12-31',
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
        if any(map(lambda x: x == None, stock_0_profit_margin_y)):  # 查看利润是否有空值，无法计算
            stock_0_profit_margin_increase_y = []
            for ix in range(0, len(stock_0_profit_margin_y)-1):
                stock_0_profit_margin_increase_y.append(None)
            stock_0_profit_margin_increase_y.append(None)  # 最后一年
        else: #
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
        stock_price_less_than_PE_ratio_y = stock_PE_ratio_target * \
            stock_0_profit_margin_y * 4  # 股份不能超过的值
        stock_price_less_than_PE_ratio_y.name = '市盈率15对应股价 元'

        stock_output_y = pd.concat([stock_0_TotalRevenue_y, stock_0_TotalAssets_y, stock_0_EBIT_y, stock_0_CurrentAssets_y, stock_0_CurrentLiabilities_y, stock_0_CurrentAssets_vs_Liabilities_y, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest_y, stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities_y, stock_0_OrdinarySharesNumber_y, stock_0_profit_margin_y, stock_0_profit_margin_increase_y, stock_0_BookValue_per_Share_y, stock_price_less_than_BookValue_ratio_y, stock_price_less_than_PE_ratio_y], axis=1)
        stock_output_y = stock_output_y.T.astype('float64').round(2)

        # # df_income_stock.T.to_excel('00.in.xlsx',encoding='utf-8')
        # # df_cash_flow.T.to_excel('00.ca.xlsx',encoding='utf-8')
        # df_balance_sheet.T.to_excel('00.ba.xlsx',encoding='utf-8')
    except:
        print('Data is not available for {} in EasyMoney.\n'.format(stock_cn))
    return [df_report_notification_date_y, stock_output_y]



################# to get the stock price for each year #####################################
def get_stock_price_range(df_report_notification_date, stock_output):
    print('Please Note: the stock price for the latest period is just to as of now...\n')
    df_report_notification_date = list(df_report_notification_date)

    # to turn the report notification date into 2024-09-30 format ###
    time_list = []
    for i in range(0, len(df_report_notification_date)):
        time_list.append(df_report_notification_date[i].split(' ')[0])

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


### to get the latest 7 days stock price #################################
def get_latest_7_days_stock_price():
    last_7_days_end = datetime.datetime.now().strftime('%Y-%m-%d')
    last_7_days_start = (datetime.datetime.now() -
                         datetime.timedelta(days=7)).strftime('%Y-%m-%d')

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

# config.read(['config1.cfg'])
# stock_settings = config['stock_name']
# stock = stock_settings['stock_name']

login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
result = login_return['result']
proxies = login_return['proxies']
finance_section_id = login_return['finance_section_id']
token_start_time = datetime.datetime.now()

# the endpoint shall not use /me, use [users] instead...
# to get the user_id first...
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

# to create a new page in OneNote to store the stock info...
# here, only define the endpoint, detailed info is listed down below after the data processing...
endpoint_create_page = 'https://graph.microsoft.com/v1.0/users/{}/onenote/sections/{}/pages'.format(user_id,finance_section_id)

for iii in range(0, len(stock_code)):  # 在所有的沪深300成分股里面进行查询

    # to split the output with 60 stock as the most info in one OneNote page. 
    # ------------一页最多放60只股票信息--------
    if iii % 60 ==0: 

        ### Create a OneNote Page ###
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
        http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                      'Content-Type': 'application/json'}

        # # below is to change the title of this page
        # page_title_value = [{
        # 'target':'title',
        # 'action':'replace',
        # 'content':'Python Test for OneNote API'
        # }]

    ### MS token expiration time info, refer to below link ###
    # https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes #

    token_time_check = datetime.datetime.now()
    time_difference = token_time_check - token_start_time
    time_difference_s = time_difference.total_seconds()
    print('Token has been used for {} mins.\n'.format(str(int(time_difference_s/60)+1)))

    if time_difference_s > 2400: # check token time, if less than 2400s, i.e. 40min, ok to use, or, get a new one.
        login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
        result = login_return['result']
        http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                      'Content-Type': 'application/json'}
        token_start_time = token_time_check

    ### Below is to define the stock code and stock name.

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

    stock_Top_temp.append('{}--{}-{}'.format(iii, stock, stock_name[iii]))

    ### to get the yearly report from the East Money ################################
    print('------- To Get the [- yearly -] report from the East Money ------------\n')
    url_yearly = Year_report_url()
    yearly_report_raw = report_from_East_Money(url_yearly)

    # get the yearly report date from above output ################################
    report_notification_date_yearly = yearly_report_raw[0]
    stock_output_yearly = yearly_report_raw[1]
    
    ### to get the Seasonly report from the East Money ################################
    print('------- To Get the  [Seasonly] report from the East Money ------------')
    url_seasonly = Seasonly_report_url(report_notification_date_yearly)
    Seasonly_report_raw = report_from_East_Money(url_seasonly)
    report_notification_date_Seasonly = Seasonly_report_raw[0]
    stock_output_Seasonly = Seasonly_report_raw[1]

    ### to get the stock price range from yahoo finance #############################
    print('------- To get the stock price range from Yahoo Finance ------------\n')
    stock_price_yearly = get_stock_price_range(report_notification_date_yearly, stock_output_yearly)
    stock_price_Seasonly = get_stock_price_range(report_notification_date_Seasonly, stock_output_Seasonly)

    ### to combine the stock price with the stock output #############################
    stock_output_yearly_f = pd.concat([stock_output_yearly, stock_price_yearly], axis=0)
    stock_output_Seasonly_f = pd.concat([stock_output_Seasonly, stock_price_Seasonly], axis=0)
    stock_output_combined = pd.concat([stock_output_Seasonly_f, stock_output_yearly_f], axis=1)

    ### to get the latest 7 days stock price #########################################
    print('get latest 7 days stock price from Yahoo Finance------------\n')
    last_7_days_stock_price_high_low = get_latest_7_days_stock_price()

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


    if (profit_margin_performance == 'xxxxxxxxx  利润 <0,  不是 一直在增长 xxxxxxx' and CurrentAssets_vs_Liabilities_performance == 'xxxxxxxxx 流动负债过高 xxxxxxxxx' and dividends_perofrmance == 'xxxxxxxxx  公司分红记录较少  xxxxxxxxx'):
        time.sleep(random.uniform(7, 13))
        continue

    else:
        page_content = "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name[iii], profit_margin_performance)
        page_content += "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name[iii], CurrentAssets_vs_Liabilities_performance)
        page_content += "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name[iii], dividends_perofrmance)
        # page_content += "<div><p>This is the output for No. #{} ---{}: {}</p></div>".format(iii, stock, stock_name[iii],)
        page_content += stock_output_combined.to_html()
        page_content += "<div><p>This is the last 7 days stock price for {} {}: {}</p></div>".format(
            stock, stock_name[iii], last_7_days_stock_price_high_low)
        # page_content += "<div><p>This is the dividend for {}: {}</p></div>".format(
            # stock, stock_name[iii])
        if stock_0_dividends.empty:
            page_content += "<div><p>No dividend record for {}: {}</p></div>".format(
                stock, stock_name[iii])
        else:
            if len(stock_0_dividends) < 15:
                page_content += stock_0_dividends.to_frame().to_html()
            else:
                page_content += stock_0_dividends[-13:].to_frame().to_html()

        # page_content += "<div><p>{}--{}-{}, {}</p></div>".format(iii, stock, stock_name[iii],dividends_perofrmance)
        # page_content += "<div><p>--------Complete this one : ↑ ↑ ↑ ↑ ↑  ---------------------</p></div>"
        page_content += "<div><p>                                                                                                </p></div>"
        # page_content = page_content.replace('\n','')
        page_content = page_content.replace('<th></th>', '<th>item</th>')

        # stock_output.to_excel('{}-Output.xlsx'.format(stock),header=1, index=1, encoding='utf_8_sig')
        print('{}--{}-{}'.format(iii, stock,
              stock_name[iii]), profit_margin_performance, '\n')
        print('{}--{}-{}'.format(iii, stock,
              stock_name[iii]), CurrentAssets_vs_Liabilities_performance, '\n')
        print('{}--{}-{}'.format(iii, stock,
              stock_name[iii]), dividends_perofrmance, '\n')
        print('This is the output for No. #{} ---{}: {} \n'.format(iii,
              stock, stock_name[iii]))
        print(tabulate(stock_output_combined, headers='keys', tablefmt='simple'))
        print('This is the last 7 days stock price for {} {}: {} \n'.format(
            stock, stock_name[iii], last_7_days_stock_price_high_low))
        # print('This is the dividend for {}: {} \n'.format(stock, stock_name[iii]))
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






        #TODO: to save the output to Excel file in OneDrive for each stock.
        # ######### Excel Operation History (Not used anymore) ##########
        #     onedrive_url = 'https://graph.microsoft.com/v1.0/'
        #     body_create_seesion = {'persistChanges': 'true'}
        #     body_create_seesion = json.dumps(body_create_seesion, indent=4)

        #     ### create a seesion id ###
        #     try:
        #         onedrive_create_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/createSession', headers = http_headers, data = body_create_seesion)
        #     except:
        #         onedrive_create_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/createSession', headers = http_headers, data = body_create_seesion, proxies=proxies)
        #     print('Create session:: status code is: ',onedrive_create_session.status_code)
        #     session_id = json.loads(onedrive_create_session.text)['id']

        #     ### Below are OneDrive Operations ###
        #     # onedrive_response = requests.get(onedrive_url + 'me/drive/root/children', headers = http_headers)
        #     http_headers['Workbook-Session-Id'] = session_id
        #     try:
        #         onedrive_response = requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/tables/Table1/rows/add', headers = http_headers, data = learning_record)
        #     except:
        #         onedrive_response = requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/tables/Table1/rows/add', headers = http_headers, data = learning_record, proxies=proxies)
        #     if (onedrive_response.status_code == 201):
        #         print('item added to Onedrive for Business Learning_records.xlsx')
        #         # data = {
        #         #     "code": {"value": "Run Succeed! Check Onedrive for Buiness Learning_record.xlsx"},
        #         # }
        #     else:
        #         print('Failed to add item to Onedrive for Business Learning_records.xlsx!')
        #         # data = {
        #         #     "code": {"value": "Failed, Check Github"},
        #         # }
        #     # openid = login_return['openid']
        #     # template_id = login_return['template_id']
        #     # funcLG.send_template_message(openid, template_id, data)    # 推送消息

        #     ### close session ###
        #     try:
        #         onedrive_close_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/closeSession', headers = http_headers)
        #     except:
        #         onedrive_close_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/closeSession', headers = http_headers, proxies=proxies)
        #     if onedrive_close_session.status_code == 204:
        #         print("Close session successfully!")
        #     else:
        #         print('Close session failed, status code is: ',onedrive_close_session.status_code)

        #         # onedrive_response = json.loads(onedrive_response.text)
        #         # items = onedrive_response['value']
        #         # for entries in range(len(items)):
        #         #     print(items[entries]['name'], '| item-id >', items[entries]['id']) # to show the files ID, which could be used in the onedrive API call


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
