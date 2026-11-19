import unittest
from unittest.mock import patch

import podcast_completed


class PodcastParsingTests(unittest.TestCase):
    def test_parse_episode_url_requires_apple_https_and_numeric_i(self):
        parsed = podcast_completed.parse_episode_url(
            "https://podcasts.apple.com/us/podcast/show/id123?i=456789")
        self.assertEqual(parsed["episode_id"], "456789")
        self.assertEqual(parsed["country"], "us")
        self.assertIsNone(podcast_completed.parse_episode_url(
            "http://podcasts.apple.com/us/podcast/show/id123?i=456789"))
        self.assertIsNone(podcast_completed.parse_episode_url(
            "https://example.com/us/podcast/show/id123?i=456789"))
        self.assertIsNone(podcast_completed.parse_episode_url(
            "https://podcasts.apple.com/us/podcast/show/id123?i=abc"))

    def test_parse_duration(self):
        self.assertEqual(podcast_completed.parse_duration("PT1H2M3S"), 3723)
        self.assertEqual(podcast_completed.parse_duration("PT45M"), 2700)
        self.assertIsNone(podcast_completed.parse_duration("unknown"))

    def test_normalize_time_to_utc(self):
        self.assertEqual(
            podcast_completed.normalize_time("2026-11-19T20:30:00+08:00"),
            "2026-11-19T12:30:00Z",
        )

    def test_repair_utf8_decoded_as_latin1(self):
        original = "西西弗高速"
        broken = original.encode("utf-8").decode("latin-1")
        self.assertEqual(podcast_completed.repair_mojibake(broken), original)

    @patch.object(podcast_completed, "scrape_episode_page", return_value={})
    @patch.object(podcast_completed, "lookup_itunes")
    def test_metadata_falls_back_to_default_title(self, lookup, _page):
        lookup.return_value = {}
        metadata = podcast_completed.collect_metadata(
            {"episode_id": "123", "country": "us", "url": "https://podcasts.apple.com/x?i=123"})
        self.assertEqual(metadata["title"], "Apple Podcasts 单集 123")
        self.assertEqual(metadata["description"], "")

    @patch.object(podcast_completed.requests, "post", side_effect=RuntimeError("offline"))
    def test_introduction_failure_is_non_fatal(self, _post):
        with patch.dict("os.environ", {"DEEPSEEK_API_KEY": "key"}):
            introduction, model = podcast_completed.generate_introduction(
                {"title": "Title", "showTitle": "Show", "description": "Description"})
        self.assertEqual(introduction, "")
        self.assertEqual(model, "")


if __name__ == "__main__":
    unittest.main()
