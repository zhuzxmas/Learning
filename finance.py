import yfinance as yf
import configparser, os

config = configparser.ConfigParser()
if os.path.exists('./config.cfg'): # to check if local file config.cfg is available, for local running application
    config.read(['config.cfg'])
    proxy_settings = config['proxy_add']
    proxy_add = proxy_settings['proxy_add']
else:
    proxy_add = os.environ['proxy_add']

stock_target = yf.Ticker('603259.ss')
stock_target_sales = stock_target.get_cashflow(freq='yearly',proxy=proxy_add)
stock_target_balance_sheet = stock_target.get_balance_sheet(freq='yearly',proxy=proxy_add)
stock_target_income = stock_target.get_income_stmt(freq='yearly',proxy=proxy_add)

### How Big The Company Is ###
stock_0_TotalRevenue = stock_target_income.loc['TotalRevenue']/100000000 #销售额
stock_0_TotalAssets = stock_target_balance_sheet.loc['TotalAssets']/100000000 #总资产
stock_0_EBIT = stock_target_income.loc['EBIT']/100000000 #息税前利润

### How Well The Company Financial Status is ###
stock_0_CurrentAssets = stock_target_balance_sheet.loc['CurrentAssets']/100000000 #流动资产
stock_0_CurrentLiabilities = stock_target_balance_sheet.loc['CurrentLiabilities']/100000000 #流动负债
stock_0_CurrentAssets_vs_Liabilities = stock_0_CurrentLiabilities/stock_0_CurrentLiabilities #流动资产与流动负债之比
stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest = stock_target_balance_sheet.loc['TotalNonCurrentLiabilitiesNetMinorityInterest']/100000000 #非流动负债合计，我认为是长期负债
stock_0_CurrentAssets_minus_TotalNonCurrentLiabilities = stock_0_CurrentAssets - stock_0_TotalNonCurrentLiabilitiesNetMinorityInterest # 流动资产扣除长期负债后应大于0

### Profit Stability of The Company ###
stock_0_profit_margin = stock_target_income.loc['DilutedEPS'] #每股稀释后收益，每股收益

### Dividend Records of The Company ###
stock_0_dividends = stock_target.get_dividends(proxy=proxy_add)

### PE Ratio of the Company ###
stock_PE_ratio_target = 15 # 这个是目标市盈率，股份不超过这个可以考虑入手
stock_price_less_than_PE_ratio = stock_PE_ratio_target * stock_0_profit_margin #股份不能超过的值

### Stock price vs Assets ratio ###
stock_0_OtherIntangibleAssets = stock_target_balance_sheet.loc['OtherIntangibleAssets']/100000000 #无形资产
stock_0_TotalLiabilitiesNetMinorityInterest = stock_target_balance_sheet.loc['TotalLiabilitiesNetMinorityInterest']/100000000 #总负债
stock_0_OrdinarySharesNumber = stock_target_balance_sheet.loc['OrdinarySharesNumber'] #普通股数量
stock_0_BookValue = stock_0_TotalAssets - stock_0_OtherIntangibleAssets - stock_0_TotalLiabilitiesNetMinorityInterest #总账面价值
stock_0_BookValue_per_Share = stock_0_BookValue*100000000/stock_0_OrdinarySharesNumber #每股账面价值
stock_price_less_than_BookValue_ratio = stock_0_BookValue_per_Share*1.5 #按账面价值计算出来的目标股价