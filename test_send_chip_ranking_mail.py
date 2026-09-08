import unittest
from unittest import mock

import onedrive_personal
from send_chip_ranking_mail import (_canonical_code, _configured_codes,
                                    _held_codes, _normalize_settings,
                                    build_html, build_rows)


class ChipRankingMailTests(unittest.TestCase):
    def fixtures(self):
        ranking = [
            {'stock_cn': '000003.SZ', 'stock_name': '<机会>', 'profit_ratio': .1,
             'latest_close': 3, 'as_of': '2026-09-05'},
            {'stock_cn': '000002.SZ', 'stock_name': '持仓否', 'profit_ratio': .3,
             'latest_close': 2, 'as_of': '2026-09-06'},
            {'stock_cn': '000001.SZ', 'stock_name': '持仓机会', 'profit_ratio': .2,
             'latest_close': 1, 'as_of': '2026-09-06', 'asset_value_per_share': 4,
             'epv_per_share': 5, 'epv_minus_asset_value': 1,
             'epv_margin_of_safety': .8},
            {'stock_cn': '000004.SZ', 'stock_name': '持仓低比例', 'profit_ratio': .1,
             'latest_close': 4, 'as_of': '2026-09-06'},
            {'stock_cn': '000005.SZ', 'stock_name': '未评估', 'profit_ratio': None,
             'latest_close': 5, 'as_of': '2026-09-07'},
            {'stock_cn': '600999.SH', 'stock_name': '已删除', 'profit_ratio': 0},
        ]
        settings = {'defaults': {}, 'stocks': {
            '000001.SZ': {'potential_opportunity': True, 'target_price': 10,
                          'opportunity_reason': '<strong>原因</strong>'},
            '000002.SZ': {'potential_opportunity': False},
            '000003.SZ': {'potential_opportunity': True},
            '000004.SZ': {'potential_opportunity': True},
        }}
        configured = {'000001.SZ', '000002.SZ', '000003.SZ', '000004.SZ', '000005.SZ'}
        return ranking, settings, configured

    def test_code_and_holdings_match_web_rules(self):
        self.assertEqual(_canonical_code('H01548金斯瑞'), '01548.HK')
        self.assertEqual(_canonical_code('东方电气600875'), '600875.SH')
        self.assertEqual(_configured_codes('Title\nH01548\n600875\n'),
                         {'01548.HK', '600875.SH'})
        self.assertEqual(_configured_codes('Title\n1\n'), {'000001.SZ'})
        self.assertEqual(_configured_codes('Title\nH 01548\n'), {'01548.HK'})
        self.assertEqual(_held_codes([
            {'code': '000001测试', 'shares': -100},
            {'code': '000001测试', 'shares': 40},
            {'code': '000002测试', 'shares': -10},
            {'code': '000002测试', 'shares': 10},
        ]), {'000001.SZ'})

    def test_rows_match_default_web_order_and_filter(self):
        ranking, settings, configured = self.fixtures()
        ranking.extend([None, 'bad'])
        rows = build_rows(ranking, [], settings, configured, configured,
                          {'000001.SZ', '000002.SZ', '000004.SZ'})
        self.assertEqual([row['stock_cn'] for row in rows], [
            '000004.SZ', '000001.SZ', '000002.SZ', '000003.SZ', '000005.SZ'])

    def test_malformed_optional_summary_entries_are_ignored(self):
        ranking, settings, configured = self.fixtures()
        rows = build_rows(ranking, [None, 'bad'], settings, configured, configured, set())
        self.assertEqual(len(rows), 5)
        self.assertTrue(all(not row['b_profit'] for row in rows))

    def test_html_has_first_eight_web_columns_markers_format_and_escaping(self):
        ranking, settings, configured = self.fixtures()
        rendered, date, count = build_html(
            ranking, [], settings, configured, configured,
            {'000001.SZ', '000002.SZ', '000004.SZ'})
        self.assertEqual((date, count), ('2026-09-07', 5))
        self.assertIn('*000004.SZ', rendered)
        self.assertIn('2026-09-07当前股价', rendered)
        self.assertIn('<th>潜在机会</th><th>目标价格</th><th>2026-09-07当前股价</th><th>原因</th>', rendered)
        self.assertIn('10.00', rendered)
        self.assertIn('&lt;strong&gt;原因&lt;/strong&gt;', rendered)
        self.assertNotIn('<strong>原因</strong>', rendered)
        self.assertIn('&lt;机会&gt;', rendered)
        self.assertNotIn('已删除', rendered)
        headers = rendered.split('<thead><tr>', 1)[1].split('</tr></thead>', 1)[0]
        self.assertEqual(headers.count('<th>'), 8)
        expected = ['股票', '潜在机会', '目标价格', '2026-09-07当前股价', '原因',
                    '获利比例', '平均成本', '90%成本区间']
        self.assertTrue(all('<th>{}</th>'.format(label) in headers for label in expected))
        self.assertNotIn('70%成本区间', headers)
        for removed in ['利润好', '负债低', '分红多', '每股 AV', '每股 EPV',
                        'EPV−AV', 'EPV 安全边际']:
            self.assertNotIn('<th>{}</th>'.format(removed), headers)
        body = rendered.split('<tbody>', 1)[1].split('</tbody>', 1)[0]
        self.assertEqual(body.count('<tr>'), 5)
        self.assertTrue(all(row.count('<td') == 8
                            for row in body.split('<tr>')[1:]))

    def test_degraded_holdings_warning(self):
        ranking, settings, configured = self.fixtures()
        rendered, _, _ = build_html(
            ranking, [], settings, configured, configured, set(),
            holdings_available=False)
        self.assertIn('持仓状态读取失败', rendered)
        self.assertNotIn('*000001.SZ', rendered)

    def test_invalid_settings_fall_back_to_empty(self):
        self.assertEqual(_normalize_settings({'stocks': []})['stocks'], {})
        self.assertEqual(_normalize_settings({'defaults': [], 'stocks': {}})['stocks'], {})
        ranking, _, configured = self.fixtures()
        rows = build_rows(ranking, [], {'defaults': {}, 'stocks': []},
                          configured, configured, set())
        self.assertTrue(all(row['potential_opportunity'] is None for row in rows))
        malformed = {'defaults': {}, 'stocks': {'000001.SZ': 'bad'}}
        rows = build_rows(ranking, [], malformed, configured, configured, set())
        row = next(item for item in rows if item['stock_cn'] == '000001.SZ')
        self.assertIsNone(row['potential_opportunity'])

    def test_shared_file_uses_graph_share_and_child_urls(self):
        responses = [
            mock.Mock(ok=True, status_code=200, json=lambda: {
                'id': 'folder-id', 'parentReference': {'driveId': 'drive-id'}}),
            mock.Mock(ok=True, status_code=200, content=b'{"records":[]}'),
        ]
        client = object.__new__(onedrive_personal.OneDrivePersonal)
        client._request = mock.Mock(side_effect=responses)
        text = client.get_shared_text('https://1drv.ms/f/example', 'stock-records.json')
        self.assertEqual(text, '{"records":[]}')
        urls = [call.args[1] for call in client._request.call_args_list]
        self.assertIn('/shares/u!', urls[0])
        self.assertTrue(urls[0].endswith('/driveItem?$select=id,parentReference'))
        self.assertTrue(urls[1].endswith(
            '/drives/drive-id/items/folder-id:/stock-records.json:/content'))


if __name__ == '__main__':
    unittest.main()
