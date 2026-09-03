import unittest

import pandas as pd

import z_Func
from finance_batch_personal import (build_valuation, canonical_stock_key,
                                    load_stock_list, ranking_row_from_output,
                                    recover_aggregate_rows, merge_canonical_rows,
                                    valuation_ranking_fields, VALUATION_ROWS)
from valuation_engine import calculate


VALUATION_TEST_ROWS = dict(VALUATION_ROWS, shares='普通股数量 百万')


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
        self.assertEqual(result["asset_value"]["adjusted_assets"], 930)
        self.assertEqual(result["asset_value"]["equity_value"], 620)
        self.assertEqual(result["asset_value"]["per_share"], 6.2)
        self.assertEqual(result["epv"]["effective_tax_rate"], 0.2)
        self.assertEqual(result["epv"]["per_share"], 4.2)

    def test_custom_assumptions(self):
        result = calculate(self.periods(), {"fixed_assets": 1, "capitalization_rate": .2})
        self.assertEqual(result["asset_value"]["per_share"], 6.2)
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

    def test_interim_snapshot_updates_assets_not_normalized_revenue(self):
        snapshot = dict(self.periods()[0], date='2026-06-30', cash=200, total_assets=1100,
                        interest_bearing_debt=100, revenue=250)
        result = calculate(self.periods(), snapshot=snapshot)
        self.assertEqual(result['asset_value']['per_share'], 7.2)
        self.assertEqual(result['epv']['normalized_ebit'], 50)
        self.assertEqual(result['epv']['per_share'], 5.4)

    def test_batch_selects_latest_half_year_snapshot(self):
        annual = self.periods()
        annual_frame = pd.DataFrame({
            row['date']: {
                label: (row.get(key) / 1e8 if key != 'shares' and row.get(key) is not None
                        else row.get(key) / 1e6 if key == 'shares' else None)
                for key, label in VALUATION_TEST_ROWS.items()
            } for row in annual
        })
        interim = dict(annual[0], date='2026-06-30', cash=200, total_assets=1100,
                       interest_bearing_debt=100, revenue=250)
        interim_frame = pd.DataFrame({
            interim['date']: {
                label: (interim.get(key) / 1e8 if key != 'shares' and interim.get(key) is not None
                        else interim.get(key) / 1e6 if key == 'shares' else None)
                for key, label in VALUATION_TEST_ROWS.items()
            }
        })
        result = build_valuation(annual_frame, {'currency': 'CNY'},
                                 stock_output_interim=interim_frame)
        self.assertEqual(result['snapshot_type'], 'interim')
        self.assertEqual(result['snapshot']['date'], '2026-06-30')
        self.assertEqual(result['asset_value']['per_share'], 7.2)
        self.assertEqual(result['epv']['normalized_ebit'], 50)

    def test_ranking_fields_flatten_valuation_summary(self):
        valuation = calculate(self.periods(), current_price=2)
        fields = valuation_ranking_fields(valuation)
        self.assertEqual(fields['asset_value_per_share'], 6.2)
        self.assertEqual(fields['epv_per_share'], 4.2)
        self.assertEqual(fields['epv_minus_asset_value'], -2.0)
        self.assertAlmostEqual(fields['asset_margin_of_safety'], 0.677419)
        self.assertAlmostEqual(fields['epv_margin_of_safety'], 0.52381)

    def test_aggregate_code_normalization(self):
        self.assertEqual(canonical_stock_key('600875.ss'), '600875.SH')
        self.assertEqual(canonical_stock_key('H09988'), '09988.HK')
        row = ranking_row_from_output({
            'stock_cn': '600104.SH', 'stock_name': '上汽集团',
            'chip_distribution': {'latest_close': 10.49, 'profit_ratio': .2},
            'valuation': calculate(self.periods(), current_price=2),
        })
        self.assertEqual(row['stock_cn'], '600104.SH')
        self.assertEqual(row['asset_value_per_share'], 6.2)

    def test_hk_alibaba_item_aliases(self):
        periods = pd.Index(['2025-12-31'])
        income = pd.DataFrame({
            'OPERATE_INCOME': [1000e8], 'OPERATE_PROFIT': [50e8],
            'PRETAX_PROFIT': [60e8], 'TAX_EBT': [20],
            'DATE_TYPE_CODE': ['001'],
        }, index=periods)
        balance = pd.DataFrame([
            ['2026-03-31', '现金及等价物', 100e8],
            ['2026-03-31', '短期投资', 50e8],
            ['2026-03-31', '预付款按金及其他应收款', 30e8],
            ['2026-03-31', '物业厂房及设备', 40e8],
            ['2026-03-31', '总负债', 80e8],
            ['2026-03-31', '少数股东权益', 5e8],
            ['2026-03-31', '可转换票据及债券', 7e8],
        ], columns=['REPORT_DATE', 'STD_ITEM_NAME', 'AMOUNT'], index=['2025-12-31'] * 7)
        cashflow = pd.DataFrame([
            ['2025-12-31', '加:折旧及摊销', 8e8],
            ['2025-12-31', '购建固定资产', 9e8],
        ], columns=['REPORT_DATE', 'STD_ITEM_NAME', 'AMOUNT'])
        rows = z_Func.valuation_rows_hk(income, balance, cashflow)
        self.assertEqual(rows.loc['估值_应收款项 亿元', '2025-12-31'], 30)
        self.assertEqual(rows.loc['估值_有价证券 亿元', '2025-12-31'], 50)
        self.assertEqual(rows.loc['估值_存货 亿元', '2025-12-31'], 0)
        self.assertEqual(rows.loc['估值_固定资产 亿元', '2025-12-31'], 40)
        self.assertEqual(rows.loc['估值_所得税费用 亿元', '2025-12-31'], 12)
        self.assertEqual(rows.loc['估值_折旧摊销 亿元', '2025-12-31'], 8)
        self.assertEqual(rows.loc['估值_有息负债 亿元', '2025-12-31'], 7)

    def test_stock_list_remains_authoritative(self):
        class FakeDrive:
            def get_text(self, path):
                if path == 'stock_list.csv':
                    return '"Title","Modified"\nH09988,\n'
                return None

        drive = FakeDrive()
        codes = load_stock_list(drive)
        self.assertEqual(codes, ['H09988'])

    def test_aggregate_recovers_from_per_stock_outputs(self):
        outputs = {
            '600104.SH': {
                'stock_cn': '600104.SH', 'stock_name': '上汽集团',
                'chip_distribution': {'latest_close': 10.49, 'profit_ratio': .2},
                'valuation': calculate(self.periods(), current_price=2),
            },
            '09988.HK': {
                'stock_cn': '09988.HK', 'stock_name': '阿里巴巴-W',
                'chip_distribution': {'latest_close': 107.5, 'profit_ratio': .3},
                'valuation': calculate(self.periods(), current_price=2),
            },
        }

        class FakeDrive:
            def list_children(self, path):
                return [{'name': code + '.json'} for code in outputs]

            def get_text(self, path):
                code = path.removeprefix('output/').removesuffix('.json')
                return __import__('json').dumps(outputs[code])

        recovered = recover_aggregate_rows(FakeDrive(), {'600104.SH'})
        self.assertEqual(len(recovered), 1)
        self.assertEqual(recovered[0][1]['stock_cn'], '09988.HK')
        self.assertEqual(recovered[0][1]['asset_value_per_share'], 6.2)
        allowed = recover_aggregate_rows(FakeDrive(), set(), {'600104.SH'})
        self.assertEqual([row['stock_cn'] for _, row in allowed], ['600104.SH'])

    def test_canonical_aggregate_merge_filters_and_fresh_wins(self):
        rows = [
            {'stock_cn': '600875.SS', 'value': 'old'},
            {'stock_cn': '09988.HK', 'value': 'deleted'},
            {'stock_cn': '600875.SH', 'value': 'fresh'},
        ]
        merged = merge_canonical_rows(
            rows, lambda row: row['stock_cn'], ['600875'])
        self.assertEqual(merged, [{'stock_cn': '600875.SH', 'value': 'fresh'}])

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
