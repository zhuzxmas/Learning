import yfinance as yf
import pandas as pd
from tabulate import tabulate
import configparser, os

config = configparser.ConfigParser()
if os.path.exists('./config.cfg'): # to check if local file config.cfg is available, for local running application
    config.read(['config.cfg'])
    proxy_settings = config['proxy_add']
    proxy_add = proxy_settings['proxy_add']
else:
    proxy_add = None

config.read(['config1.cfg'])
stock_settings = config['stock_name']
stock = stock_settings['stock_name']

stock_target = yf.Ticker(stock)
stock_target_sales = stock_target.get_cashflow(freq='yearly',proxy=proxy_add)
stock_target_balance_sheet = stock_target.get_balance_sheet(freq='yearly',proxy=proxy_add)
stock_target_income = stock_target.get_income_stmt(freq='yearly',proxy=proxy_add)

### How Big The Company Is ###
stock_0_TotalRevenue = stock_target_income.loc['TotalRevenue']/100000000 #销售额
stock_0_TotalRevenue.name = '销售额 亿元'
stock_0_TotalAssets = stock_target_balance_sheet.loc['TotalAssets']/100000000 #总资产
stock_0_TotalAssets.name = '总资产 亿元'
stock_0_EBIT = stock_target_income.loc['EBIT']/100000000 #息税前利润
stock_0_EBIT.name = '息税前利润 亿元'

### How Well The Company Financial Status is ###
stock_0_CurrentAssets = stock_target_balance_sheet.loc['CurrentAssets']/100000000 #流动资产
stock_0_CurrentAssets.name = '流动资产 亿元'
stock_0_CurrentLiabilities = stock_target_balance_sheet.loc['CurrentLiabilities']/100000000 #流动负债
stock_0_CurrentLiabilities.name = '流动负债 亿元'
stock_0_CurrentAssets_vs_Liabilities = stock_target_balance_sheet.loc['CurrentAssets']/stock_target_balance_sheet.loc['CurrentLiabilities'] #流动资产与流动负债之比 应>2
stock_0_CurrentAssets_vs_Liabilities.name = '流动资产与流动负债之比 应>2'
stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest = stock_target_balance_sheet.loc['TotalNonCurrentLiabilitiesNetMinorityInterest']/100000000 #非流动负债合计，我认为是长期负债
stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest.name = '非流动负债合计 长期负债'
stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities = stock_0_CurrentAssets - stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest # 流动资产扣除长期负债后应大于0
stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities.name = '流动资产扣除长期负债后应大于0'

### Profit Stability of The Company ###
stock_0_profit_margin = stock_target_income.loc['DilutedEPS'] #每股稀释后收益，每股收益
stock_0_profit_margin.name = '稀释后 每股收益 元'

### Dividend Records of The Company ###
stock_0_dividends = stock_target.get_dividends(proxy=proxy_add)

### PE Ratio of the Company ###
stock_PE_ratio_target = 15 # 这个是目标市盈率，股份不超过这个可以考虑入手
stock_price_less_than_PE_ratio = stock_PE_ratio_target * stock_0_profit_margin #股份不能超过的值
stock_price_less_than_PE_ratio.name = '市盈率15对应的目标股价 元'

### Stock price vs Assets ratio ###
stock_0_OtherIntangibleAssets = stock_target_balance_sheet.loc['OtherIntangibleAssets']/100000000 #无形资产
stock_0_TotalLiabilitiesNetMinorityInterest = stock_target_balance_sheet.loc['TotalLiabilitiesNetMinorityInterest']/100000000 #总负债
stock_0_OrdinarySharesNumber = stock_target_balance_sheet.loc['OrdinarySharesNumber'] #普通股数量
stock_0_BookValue = stock_0_TotalAssets - stock_0_OtherIntangibleAssets - stock_0_TotalLiabilitiesNetMinorityInterest #总账面价值
stock_0_BookValue_per_Share = stock_0_BookValue*100000000/stock_0_OrdinarySharesNumber #每股账面价值
stock_0_BookValue_per_Share.name = '每股账面价值 元'
stock_price_less_than_BookValue_ratio = stock_0_BookValue_per_Share*1.5 #按账面价值计算出来的目标股价
stock_price_less_than_BookValue_ratio.name = '每股账面价值的1.5倍 元'

stock_output = pd.concat([stock_0_TotalRevenue, stock_0_TotalAssets, stock_0_EBIT, stock_0_CurrentAssets, stock_0_CurrentLiabilities, stock_0_CurrentAssets_vs_Liabilities, stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest, stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities, stock_0_BookValue_per_Share, stock_price_less_than_BookValue_ratio, stock_price_less_than_PE_ratio, stock_0_profit_margin], axis=1)
stock_output = stock_output.T.astype('float64').round(2)
stock_output.columns = stock_output.columns.strftime(date_format='%Y-%m-%d')
# stock_output.to_excel('{}-Output.xlsx'.format(stock),header=1, index=1, encoding='utf_8_sig')
print('This is the output for {}: \n'.format(stock))
print(tabulate(stock_output,headers='keys',tablefmt='psql'))
print('This is the dividend for {}: \n'.format(stock))
print(stock_0_dividends)