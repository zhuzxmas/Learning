import unittest

from send_stock_detail_mail import build_detail_html, canonical_stock


class StockDetailMailTests(unittest.TestCase):
    def stock_data(self):
        periods = [dict(
            date=str(2025 - index), shares=100, total_assets=1000,
            total_liabilities=300, cash=100, securities=50,
            receivables=100, inventory=100, fixed_assets=400,
            intangibles=50, goodwill=20, minority_interest=10,
            interest_bearing_debt=120, revenue=500, ebit=50,
            pretax_profit=45, income_tax=9, depreciation_amortization=20,
        ) for index in range(7)]
        return {
            'stock': '600104.ss', 'stock_cn': '600104.SH',
            'stock_name': '<上汽&集团>', 'generated': '2026-09-11T08:00:00Z',
            'last_7_days_high_low': {'low': 9.5, 'high': 11.2},
            'price_range_gaps': ['2018年'],
            'checks': {
                'profit': {'pass': True, 'text': '利润 <稳定>'},
                'debt': {'pass': False, 'text': '负债 & 检查'},
            },
            'combined': {
                'columns': ['2025-12-31', '2024-12-31'],
                'index': ['营业收入', '<特殊指标>'],
                'data': [[500, 480], ['<script>', None]],
            },
            'dividends': [{'日期': '2026-06-01', '方案': '10派3元<含税>'}],
            'chip_distribution': {
                'profit_ratio': .25, 'latest_close': 10.5, 'avg_cost': 9.2,
                'cost_90_low': 7, 'cost_90_high': 12,
                'cost_70_low': 8, 'cost_70_high': 11,
            },
            'valuation': {
                'applicable': True, 'currency': 'CNY', 'as_of': '2025-12-31',
                'snapshot_as_of': '2025-12-31', 'snapshot_type': 'annual',
                'periods_used': 7, 'raw_periods': periods,
                'snapshot': periods[0],
                'quote': {'current_price': 2, 'currency': 'CNY', 'as_of': '2026-09-10'},
            },
        }

    def settings(self):
        return {'defaults': {}, 'stocks': {'600104.SH': {
            'capitalization_rate': .20,
            'potential_opportunity': True,
            'target_price': 8.88,
            'opportunity_reason': '<strong>低估&关注</strong>',
            'opportunity_updated_at': '2026-09-10T10:00:00Z',
            'opportunity_updated_by': 'owner@example.com',
        }}}

    def test_complete_detail_matches_saved_page_data(self):
        rendered, subject = build_detail_html(self.stock_data(), self.settings())
        self.assertEqual(subject, '选股详情 · 600104.SH <上汽&集团>')
        for heading in ('基本判断', '投资判断', '价值投资估值', '估值参数与计算明细',
                        '估值敏感性', '筹码与价格', '近期高低', '财务指标', '分红记录'):
            self.assertIn('<h3>{}</h3>'.format(heading), rendered)
        self.assertIn('CNY 2.20', rendered)  # EPV with saved 20% capitalization rate
        self.assertIn('20.0%', rendered)
        self.assertIn('8.88', rendered)
        self.assertIn('25.0%', rendered)
        self.assertIn('7.00 ~ 12.00', rendered)
        self.assertIn('2018年', rendered)
        self.assertIn('9.5', rendered)
        self.assertIn('EPV 20.0%', rendered)
        self.assertIn('2026-09-10', rendered)
        self.assertIn('盈利年报数量', rendered)
        self.assertIn('账面总资产', rendered)
        self.assertIn('总负债', rendered)
        self.assertIn('少数股东权益', rendered)
        self.assertIn('&lt;上汽&amp;集团&gt;', rendered)
        self.assertIn('&lt;strong&gt;低估&amp;关注&lt;/strong&gt;', rendered)
        self.assertNotIn('<script>', rendered)
        self.assertIn('&lt;script&gt;', rendered)

    def test_missing_sections_render_safely(self):
        data = {'stock_cn': '00168.HK', 'stock_name': '青岛啤酒', 'checks': {},
                'combined': None, 'dividends': [], 'valuation': None}
        rendered, subject = build_detail_html(data, {})
        self.assertIn('00168.HK', subject)
        self.assertIn('暂无分红记录', rendered)
        self.assertIn('<h3>财务指标</h3>', rendered)
        self.assertNotIn('<script>', rendered)

    def test_code_validation(self):
        self.assertEqual(canonical_stock('01211.hk'), '01211.HK')
        self.assertEqual(canonical_stock('600104.sh'), '600104.SH')
        for value in ('H01211', 'H012345', '600104', '../secret', '', '٠١٢١١.HK'):
            with self.assertRaises(ValueError):
                canonical_stock(value)


if __name__ == '__main__':
    unittest.main()
