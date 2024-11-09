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
# stock_code = [600885, 688981, 688599, 688561, 688396, 688363, 688303, 688271, 688256, 688223, 688187, 688126, 688111, 688065, 688041, 688036, 688012, 688008, 605499, 605117, 603993, 603986, 603899, 603833, 603806, 603799, 603659, 603501, 603486, 603392, 603369, 603290, 603288, 603260, 603259, 603195, 603019, 601998, 601995, 601989, 601988, 601985, 601939, 601919, 601916, 601901, 601899, 601898, 601888, 601881, 601878, 601877, 601872, 601868, 601865, 601857, 601838, 601818, 601816, 601808, 601800, 601799, 601788, 601766, 601728, 601699, 601698, 601689, 601688, 601669, 601668, 601658, 601633, 601628, 601618, 601615, 601607, 601601, 601600, 601398, 601390, 601377, 601360, 601336, 601328, 601319, 601318, 601288, 601238, 601236, 601229, 601225, 601211, 601186, 601169, 601166, 601155, 601138, 601117, 601111, 601100, 601088, 601066, 601059, 601021, 601012, 601009, 601006, 600999, 600989, 600958, 600941, 600938, 600926, 600919, 600918, 600905, 600900, 600893, 600887, 600886, 600875, 600845, 600837, 600809, 600803, 600795, 600760, 600754, 600745, 600741, 600732, 600690, 600674, 600660, 600606, 600600, 600588, 600585, 600584, 600570, 600547, 600519, 600515, 600489, 600460, 600438, 600436, 600426, 600406, 600372, 600362, 600346, 600332, 600309, 600276, 600233, 600219, 600196, 600188, 600183, 600176, 600150, 600132, 600115, 600111, 600104, 600089, 600085, 600061, 600050, 600048, 600039, 600036, 600031, 600030, 600029, 600028, 600025, 600023, 600019, 600018, 600016, 600015, 600011, 600010, 600009, 600000, 301269, 300999, 300979, 300957, 300919, 300896, 300782, 300763, 300760, 300759, 300751, 300750, 300661, 300628, 300498, 300496, 300454, 300450, 300433, 300413, 300408, 300347, 300316, 300308, 300274, 300223, 300142, 300124, 300122, 300059, 300033, 300015, 300014, 3816, 2938, 2920, 2916, 2841, 2821, 2812, 2736, 2714, 2709, 2648, 2603, 2601, 2594, 2555, 2493, 2475, 2466, 2460, 2459, 2415, 2410, 2371, 2352, 2311, 2304, 2271, 2252, 2241, 2236, 2230, 2202, 2180, 2179, 2142, 2129, 2074, 2050, 2049, 2027, 2007, 2001, 1979, 1289, 999, 983, 977, 963, 938, 895, 877, 876, 858, 800, 792, 786, 776, 768, 733, 725, 708, 661, 651, 625, 617, 596, 568, 538, 425, 408, 338, 333, 301, 166, 157, 100, 69, 63, 'F']
stock_code = [600885, 603259, 600276, 600196, 603899, 603986, 603833, 603806, 603369, 601877, 601607, 601238, 601186, 601100, 600875, 600741, 600406, 600132, 600104, 2415, 2050, 895, 733, 661, 603288, 600845, 600690, 600660, 600600, 600332, 600085, 300628, 300124, 'F']

# stock_name = ['宏发股份', '中芯国际', '天合光能', '奇安信', '华润微', '华熙生物', '大全能源', '联影医疗', '寒武纪', '晶科能源', '时代电气', '沪硅产业', '金山办公', '凯赛生物', '海光信息', '传音控股', '中微公司', '澜起科技', '东鹏饮料', '德业股份', '洛阳钼业', '兆易创新', '晨光股份', '欧派家居', '福斯特', '华友钴业', '璞泰来', '韦尔股份', '科沃斯', '万泰生物', '今世缘', '斯达半导', '海天味业', '合盛硅业', '药明康德', '公牛集团', '中科曙光', '中信银行', '中金公司', '中国重工', '中国银行', '中国核电', '建设银行', '中远海控', '浙商银行', '方正证券', '紫金矿业', '中煤能源', '中国中免', '中国银河', '浙商证券', '正泰电器', '招商轮船', '中国能建', '福莱特', '中国石油', '成都银行', '光大银行', '京沪高铁', '中海油服', '中国交建', '星宇股份', '光大证券', '中国中车', '中国电信', '潞安环能', '中国卫通', '拓普集团', '华泰证券', '中国电建', '中国建筑', '邮储银行', '长城汽车', '中国人寿', '中国中冶', '明阳智能', '上海医药', '中国太保', '中国铝业', '工商银行', '中国中铁', '兴业证券', '三六零', '新华保险', '交通银行', '中国人保', '中国平安', '农业银行', '广汽集团', '红塔证券', '上海银行', '陕西煤业', '国泰君安', '中国铁建', '北京银行', '兴业银行', '新城控股', '工业富联', '中国化学', '中国国航', '恒立液压', '中国神华', '中信建投', '信达证券', '春秋航空', '隆基绿能', '南京银行', '大秦铁路', '招商证券', '宝丰能源', '东方证券', '中国移动', '中国海油', '杭州银行', '江苏银行', '中泰证券', '三峡能源', '长江电力', '航发动力', '伊利股份', '国投电力', '东方电气', '宝信软件', '海通证券', '山西汾酒', '新奥股份', '国电电力', '中航沈飞', '锦江酒店', '闻泰科技', '华域汽车', '爱旭股份', '海尔智家', '川投能源', '福耀玻璃', '绿地控股', '青岛啤酒', '用友网络', '海螺水泥', '长电科技', '恒生电子', '山东黄金', '贵州茅台', '海南机场', '中金黄金', '士兰微', '通威股份', '片仔癀', '华鲁恒升', '国电南瑞', '中航机载', '江西铜业', '恒力石化', '白云山', '万华化学', '恒瑞医药', '圆通速递', '南山铝业', '复星医药', '兖矿能源', '生益科技', '中国巨石', '中国船舶', '重庆啤酒', '中国东航', '北方稀土', '上汽集团', '特变电工', '同仁堂', '国投资本', '中国联通', '保利发展', '四川路桥', '招商银行', '三一重工', '中信证券', '南方航空', '中国石化', '华能水电', '浙能电力', '宝钢股份', '上港集团', '民生银行', '华夏银行', '华能国际', '包钢股份', '上海机场', '浦发银行', '华大九天', '金龙鱼', '华利集团', '贝泰妮', '中伟股份', '爱美客', '卓胜微', '锦浪科技', '迈瑞医疗', '康龙化成', '迈为股份', '宁德时代', '圣邦股份', '亿联网络', '温氏股份', '中科创达', '深信服', '先导智能', '蓝思科技', '芒果超媒', '三环集团', '泰格医药', '晶盛机电', '中际旭创', '阳光电源', '北京君正', '沃森生物', '汇川技术', '智飞生物', '东方财富', '同花顺', '爱尔眼科', '亿纬锂能', '中国广核', '鹏鼎控股', '德赛西威', '深南电路', '视源股份', '凯莱英', '恩捷股份', '国信证券', '牧原股份', '天赐材料', '卫星化学', '以岭药业', '龙佰集团', '比亚迪', '三七互娱', '荣盛石化', '立讯精密', '天齐锂业', '赣锋锂业', '晶澳科技', '海康威视', '广联达', '北方华创', '顺丰控股', '海大集团', '洋河股份', '东方雨虹', '上海莱士', '歌尔股份', '大华股份', '科大讯飞', '金风科技', '纳思达', '中航光电', '宁波银行', 'TCL中环', '国轩高科', '三花智控', '紫光国微', '分众传媒', '华兰生物', '新和成', '招商蛇口', '龙源电力', '华润三九', '山西焦煤', '浪潮信息', '华东医药', '紫光股份', '双汇发展', '天山股份', '新希望', '五粮液', '一汽解放', '盐湖股份', '北新建材', '广发证券', '中航西飞', '振华科技', '京东方A', '中信特钢', '长春高新', '格力电器', '长安汽车', '中油资本', '古井贡酒', '泸州老窖', '云南白药', '徐工机械', '藏格矿业', '潍柴动力', '美的集团', '东方盛虹', '申万宏源', '中联重科', 'TCL科技', '华侨城A', '中兴通讯', 'Ford']
stock_name = ['宏发股份', '药明康德', '恒瑞医药', '复星医药', '晨光股份', '兆易创新', '欧派家居', '福斯特', '今世缘', '正泰电器', '上海医药', '广汽集团', '中国铁建', '恒立液压', '东方电气', '华域汽车', '国电南瑞', '重庆啤酒', '上汽集团', '海康威视', '三花智控', '双汇发展', '振华科技', '长春高新', '海天味业', '宝信软件', '海尔智家', '福耀玻璃', '青岛啤酒', '白云山', '同仁堂', '亿联网络', '汇川技术', 'Ford']

def generate_random_string(length):
    # Generate a random string of the specified length
    return ''.join([str(random.randint(0, 9)) for _ in range(length)])

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

# config.read(['config1.cfg'])
# stock_settings = config['stock_name']
# stock = stock_settings['stock_name']

stock_Top_list = []
stock_Top_list_columns = ['Stock Number', '利润表现好', '流动负债不高', '分红多']

day_one = datetime.date.today()

login_return = funcLG.func_login_secret()  # to login into MS365 and get the return value
result = login_return['result']
proxies = login_return['proxies']
finance_section_id = login_return['finance_section_id']
token_start_time = datetime.datetime.now()

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

endpoint_create_page = 'https://graph.microsoft.com/v1.0/users/{}/onenote/sections/{}/pages'.format(user_id,finance_section_id)

for iii in range(0, len(stock_code)):  # 在所有的沪深300成分股里面进行查询
    if iii % 60 ==0: # to split the output with 60 stock as the most info in one OneNote page. 一页最多放60只股票信息
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

    ### 以下是对一只股票进行查询 ###
    stock_target = yf.Ticker(stock)
    stock_target_sales = stock_target.get_cashflow(
        freq='yearly', proxy=proxy_add)
    stock_target_balance_sheet = stock_target.get_balance_sheet(
        freq='yearly', proxy=proxy_add)
    stock_target_income = stock_target.get_income_stmt(
        freq='yearly', proxy=proxy_add)

    if 'EBIT' in stock_target_income.index and 'CurrentAssets' in stock_target_balance_sheet.index and 'TotalRevenue' in stock_target_income.index and 'TotalAssets' in stock_target_balance_sheet.index and 'CurrentLiabilities' in stock_target_balance_sheet.index and 'TotalNonCurrentLiabilitiesNetMinorityInterest' in stock_target_balance_sheet.index and 'DilutedEPS' in stock_target_income.index and 'OtherIntangibleAssets' in stock_target_balance_sheet.index and 'TotalLiabilitiesNetMinorityInterest' in stock_target_balance_sheet.index and 'OrdinarySharesNumber' in stock_target_balance_sheet.index:
        print('-----Stock No.{}---Begin of {}: ↓ ↓ ↓ ↓ ↓  ---------------\n'.format(iii, stock))
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

        stock_Top_temp.append('{}--{}-{}'.format(iii, stock, stock_name[iii]))

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

        if (profit_margin_performance == 'xxxxxxxxx  利润 <0,  不是 一直在增长 xxxxxxx' and CurrentAssets_vs_Liabilities_performance == 'xxxxxxxxx 流动负债过高 xxxxxxxxx' and dividends_perofrmance == 'xxxxxxxxx  公司分红记录较少  xxxxxxxxx'):
            time.sleep(random.uniform(7, 13))
            continue
        else:
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

            string_v1 = generate_random_string(17)
            string_v2 = generate_random_string(17)
            string_v3 = generate_random_string(18)

            if (stock[7:] == 'ss' or stock[7:] == 'sz') and (len(stock) == 9):  # for CN stock: to be updated later
                url_eastmoney_income = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
                    'ace', 'tmo', p_income, p_income, stock_cn, day_one.year, day_one.year, day_one.year, string_v1)

                url_eastmoney_cash_flow = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=APP_F10_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
                    'ace', 'tmo', p_cash_flow, p_cash_flow, stock_cn, day_one.year, day_one.year, day_one.year, string_v2)

                url_eastmoney_balance_sheet = 'https://dat{}nter.eas{}ney.com/securities/api/data/get?type=RPT_F10_FINANCE_G{}&sty=F10_FINANCE_G{}&filter=(SECUCODE%3D%22{}%22)(REPORT_DATE%20in%20(%27{}-09-30%27%2C%27{}-06-30%27%2C%27{}-03-31%27))&p=1&ps=5&sr=-1&st=REPORT_DATE&source=HSF10&client=PC&v={}'.format(
                    'ace', 'tmo', p_balance_sheet, p_balance_sheet, stock_cn, day_one.year, day_one.year, day_one.year, string_v3)


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
                time.sleep(random.uniform(11, 15))

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
                time.sleep(random.uniform(11, 15))

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
                time.sleep(random.uniform(11, 15))

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
                    }
                    new_index_income = df_income_stock.index.to_series().replace(quarter_mapping_income, regex=True)
                    df_income_stock = df_income_stock.set_index(pd.Index(new_index_income, name='REPORT_DATE_NAME'))

                    quarter_mapping_cash_flow = {
                        '一季报': '-03-31',
                        '中报': '-06-30',
                        '三季报': '-09-30',
                    }
                    new_index_cash_flow = df_cash_flow.index.to_series().replace(quarter_mapping_cash_flow, regex=True)
                    df_cash_flow = df_cash_flow.set_index(pd.Index(new_index_cash_flow, name='REPORT_DATE_NAME'))
                    df_balance_sheet = df_balance_sheet.set_index(pd.Index(new_index_cash_flow, name='REPORT_DATE_NAME'))

                    ### How Big The Company Is ###
                    # 销售额
                    stock_0_TotalRevenue_m = df_income_stock['TOTAL_OPERATE_INCOME']/100000000
                    stock_0_TotalRevenue_m.name = '营业总收入 销售额 亿元'
                    # 总资产
                    stock_0_TotalAssets_m = df_balance_sheet['TOTAL_ASSETS']/100000000
                    stock_0_TotalAssets_m.name = '总资产 亿元'
                    stock_0_EBIT_m = df_income_stock['OPERATE_PROFIT']/100000000  # 息税前利润
                    stock_0_EBIT_m.name = '营业收入 息税前利润 亿元'

                    ### Profit Stability of The Company ###
                    # 每股稀释后收益 季度，每股收益
                    stock_0_profit_margin_m = df_income_stock['DILUTED_EPS']
                    stock_0_profit_margin_m.name = '稀释后 每年/季度每股收益 元'

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
                        100000000/(stock_0_OrdinarySharesNumber_m*1000000)  # 每股账面价值
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

            # ===== End To Get This Year Monthly Info from EastMoney End ====#

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
            iii, stock, stock_name[iii], profit_margin_performance)
        page_content += "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name[iii], CurrentAssets_vs_Liabilities_performance)
        page_content += "<div><p>{}--{}-{}, {}</p></div>".format(
            iii, stock, stock_name[iii], dividends_perofrmance)
        # page_content += "<div><p>This is the output for No. #{} ---{}: {}</p></div>".format(iii, stock, stock_name[iii],)
        page_content += stock_output.to_html()
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
        print(tabulate(stock_output, headers='keys', tablefmt='simple'))
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
    else:
        print('Something is missing for {} ---{}: {} \n'.format(iii,
              stock, stock_name[iii]))
        print('                                                                                                \n')
        time.sleep(random.uniform(7, 13))


stock_Top_list = pd.DataFrame(stock_Top_list, columns=stock_Top_list_columns).sort_values(
    by=['利润表现好', '流动负债不高', '分红多'], ascending=False)
print(tabulate(stock_Top_list, headers='keys', tablefmt='simple',))
page_content = stock_Top_list.to_html()
# page_content = page_content.replace('\n','')
page_content = page_content.replace('<th></th>', '<th>item</th>')


### Create a OneNote Page for the summary ###
http_headers_create_page = {'Authorization': 'Bearer ' + result['access_token'],
              'Content-Type': 'application/xhtml+xml'}
page_title = 'Summary for {} Stock Info'.format(day_one.strftime('%Y-%m-%d'))
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
if data.status_code == 201:
    print('Created OneNote page successfully! \n')
onenote_page_id = data.json()['id']  # this is the id for OneNote page created above..


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
print('Status Code for append Summary Table: {}\n'.format(data.status_code))
if data.status_code == 204:
    print('Info Added to OneNote page successfully! \n')

print('Task Completed! \n')
