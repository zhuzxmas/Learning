import unittest

import pandas as pd

import z_Func
from finance_batch_personal import build_valuation
from valuation_engine import calculate


class ValuationEngineTests(unittest.TestCase):
    def periods(self):
        return [dict(
            date=str(2025 - i), shares=100, total_assets=1000,
            total_liabilities=300, cash=100, securities=50,
            receivables=100, inventory=100, fixed_assets=400,
            intangibles=50, goodwill=20, minority_interest=10,
            interest_bearing_debt=120, revenue=500,
            ebit=50, pretax_profit=45, income_tax=9,
            depreciation_amortization=20,
        ) for i in range(7)]

    def test_asset_value_and_epv(self):
        result = calculate(self.periods(), current_price=2)
        self.assertTrue(result["complete"])
        self.assertEqual(result["asset_value"]["adjusted_assets"], 595)
        self.assertEqual(result["asset_value"]["equity_value"], 285)
        self.assertEqual(result["asset_value"]["per_share"], 2.85)
        self.assertEqual(result["epv"]["effective_tax_rate"], 0.2)
        self.assertEqual(result["epv"]["per_share"], 4.2)

    def test_custom_assumptions(self):
        result = calculate(self.periods(), {"fixed_assets": 1, "capitalization_rate": .2})
        self.assertEqual(result["asset_value"]["per_share"], 4.85)
        self.assertEqual(result["epv"]["operating_value"], 200)

    def test_missing_is_not_zero(self):
        rows = self.periods()
        del rows[0]["inventory"]
        result = calculate(rows)
        self.assertIsNone(result["asset_value"])
        self.assertIn("inventory", result["missing"])

    def test_financial_company_not_applicable(self):
        result = calculate(self.periods(), industry="银行Ⅱ")
        self.assertFalse(result["applicable"])

    def test_abnormal_tax_rates_are_ignored(self):
        rows = self.periods()
        for row in rows:
            row["income_tax"] = 100
        result = calculate(rows)
        self.assertEqual(result["epv"]["effective_tax_rate"], .25)

    def test_a_share_statement_mapping_and_batch_units(self):
        income = pd.read_csv('00.600875_income.csv', index_col=0).T
        cashflow = pd.read_csv('00.600875_cash_flow.csv', index_col=0).T
        balance = pd.read_csv('00.600875_balance_sheet.csv', index_col=0).T
        valuation_rows = z_Func.valuation_rows_a(income, cashflow, balance)
        expected_receivables = (float(balance['NOTE_ACCOUNTS_RECE'].iloc[0])
                                + float(balance['FINANCE_RECE'].iloc[0])) / 1e8
        self.assertAlmostEqual(valuation_rows.loc['估值_应收款项 亿元'].iloc[0],
                               expected_receivables)
        expected_ebit = (float(income['OPERATE_PROFIT'].iloc[0])
                         - float(income['INVEST_INCOME'].iloc[0])
                         - float(income['FAIRVALUE_CHANGE_INCOME'].iloc[0])
                         - float(income['ASSET_DISPOSAL_INCOME'].iloc[0])
                         - float(income['OTHER_INCOME'].iloc[0])
                         + float(income['FINANCE_EXPENSE'].iloc[0])) / 1e8
        self.assertAlmostEqual(valuation_rows.loc['估值_息税前利润 亿元'].iloc[0], expected_ebit)
        base_rows = pd.DataFrame({
            column: {
                '总资产 亿元': float(balance.loc[column, 'TOTAL_ASSETS']) / 1e8,
                '营业总收入 销售额 亿元': float(income.loc[column, 'TOTAL_OPERATE_INCOME']) / 1e8,
                '营业收入 息税前利润 亿元': float(income.loc[column, 'OPERATE_PROFIT']) / 1e8,
                '普通股数量 百万': float(balance.loc[column, 'SHARE_CAPITAL']) / 1e6,
            } for column in income.index
        })
        report = pd.concat([base_rows, valuation_rows])
        result = build_valuation(report, {'currency': 'CNY', 'current_price': 10})
        self.assertTrue(result['applicable'])
        self.assertGreater(result['raw_periods'][0]['cash'], 1e9)
        self.assertGreater(result['raw_periods'][0]['receivables'], 1e9)
        self.assertIsNotNone(result['asset_value'])
        self.assertIsNotNone(result['epv'])


if __name__ == "__main__":
    unittest.main()
