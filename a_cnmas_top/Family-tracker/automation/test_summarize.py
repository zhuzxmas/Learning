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
        self.assertTrue(any(part.startswith("### [贴吧] 旧主题\n") for part in parts))
        self.assertIn("主题：旧主题", text)
        self.assertIn("新主题", text)
        self.assertIn("本期回复", text)
        self.assertNotIn("旧首楼", text)
        self.assertNotIn("无活动", text)

    def test_blog_uses_publication_time_not_modified_time(self):
        index = {"posts": [
            {"id": "2026-08-18-01", "title": "本期发表", "date": "2026-08-18",
             "created": "2026-08-18T01:00:00Z"},
            {"id": "2026-07-01-01", "title": "旧文修改", "date": "2026-07-01",
             "created": "2026-07-01T01:00:00Z"},
            {"id": "2026-08-10-01", "title": "旧格式本期文章", "date": "2026-08-10"},
        ]}
        files = [
            {"name": "2026-08-18-01.md", "file": {}, "lastModifiedDateTime": "2026-08-18T02:00:00Z"},
            {"name": "2026-07-01-01.md", "file": {}, "lastModifiedDateTime": "2026-08-19T02:00:00Z"},
            {"name": "2026-08-10-01.md", "file": {}, "lastModifiedDateTime": "2026-08-10T02:00:00Z"},
        ]
        texts = {
            "blog-index.json": json.dumps(index),
            "posts/2026-08-18-01.md": "新正文",
            "posts/2026-07-01-01.md": "旧正文被修改",
            "posts/2026-08-10-01.md": "旧格式正文",
        }
        with patch.object(summarize, "resolve_folder", return_value="blog-base"), \
             patch.object(summarize, "list_children", return_value=files), \
             patch.object(summarize, "get_text", side_effect=lambda token, base, path: texts.get(path)):
            _, parts = summarize.collect_blog("token", self.window)
        text = "\n".join(parts)
        self.assertIn("本期发表", text)
        self.assertIn("旧格式本期文章", text)
        self.assertNotIn("旧文修改", text)

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
