import datetime as dt
import json
import unittest
from unittest.mock import patch

import summarize


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.window = summarize.beijing_window(
            dt.datetime(2026, 8, 20, 8, 0, tzinfo=summarize.BEIJING), days=14)

    def test_forum_includes_new_topic_and_new_reply_only(self):
        index = {
            "topics": [
                {"id": "new", "title": "新主题", "author": "Nathan",
                 "created": "2026-08-18T01:00:00Z", "lastUpdated": "2026-08-18T01:00:00Z"},
                {"id": "old", "title": "旧主题", "author": "Celine",
                 "created": "2026-07-01T01:00:00Z", "lastUpdated": "2026-08-19T02:00:00Z"},
                {"id": "stale", "title": "无活动", "author": "Cloud",
                 "created": "2026-07-01T01:00:00Z", "lastUpdated": "2026-07-02T01:00:00Z"},
            ]
        }
        files = {
            "forum-index.json": json.dumps(index),
            "forum/new.json": json.dumps({"posts": [
                {"author": "Nathan", "content": "首楼", "created": "2026-08-18T01:00:00Z"}
            ]}),
            "forum/old.json": json.dumps({"posts": [
                {"author": "Celine", "content": "旧首楼", "created": "2026-07-01T01:00:00Z"},
                {"author": "Nathan", "content": "本期回复", "created": "2026-08-19T02:00:00Z"},
            ]}),
        }
        with patch.object(summarize, "get_text", side_effect=lambda token, base, path: files.get(path)):
            parts = summarize.collect_forum("token", "base", self.window)
        text = "\n".join(parts)
        self.assertEqual(len(parts), 2)
        self.assertIn("新主题", text)
        self.assertIn("本期回复", text)
        self.assertNotIn("旧首楼", text)
        self.assertNotIn("无活动", text)

    def test_travel_uses_visit_date_and_includes_boundaries(self):
        records = {"records": [
            {"title": "起始日", "date": "2026-08-06", "people": ["Nathan"],
             "remark": "边界", "modified": "2026-01-01T00:00:00Z"},
            {"title": "结束日", "date": "2026-08-20", "people": ["Cloud"],
             "remark": "当天", "modified": "2026-01-01T00:00:00Z"},
            {"title": "过早", "date": "2026-08-05", "people": [],
             "modified": "2026-08-19T00:00:00Z"},
        ]}
        with patch.object(summarize, "resolve_folder", return_value="travel-base"), \
             patch.object(summarize, "get_text", return_value=json.dumps(records)):
            parts = summarize.collect_travel("token", self.window)
        self.assertEqual(len(parts), 1)
        self.assertIn("起始日", parts[0])
        self.assertIn("结束日", parts[0])
        self.assertNotIn("过早", parts[0])
        self.assertNotIn("modified", parts[0])


if __name__ == "__main__":
    unittest.main()
