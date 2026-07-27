#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert a SharePoint modern-pages Graph export (blog_export.json) into a
blog module dataset:

  out/blog-index.json     [{id,title,date,excerpt,searchText,images}, ...]
  out/posts/<id>.md       one Markdown file per post
  out/images/<file>       images copied from ../../blog_images (if present)

Source shape (Graph GET /sites/{id}/pages/microsoft.graph.sitePage?$expand=canvasLayout):
  value[] -> page objects with:
    title, name, createdDateTime, lastModifiedDateTime, webUrl
    canvasLayout.horizontalSections[] -> columns[] -> webparts[]
      textWebPart     : innerHtml (rich HTML)
      standardWebPart : data.serverProcessedContent.imageSources[0].value
                        (server-relative path .../<file>.jpg)

Ordering: sections carry an 'id' like '2.75' -> sort as FLOAT.
Date: prefer YYYY.MM.DD prefix in title, else createdDateTime.
The 'Home' page is excluded.

Console note: Windows console is cp1252 -> never print non-ASCII text.
"""
import json, os, re, sys, html
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)            # spending-tracker/
BASE = os.path.dirname(ROOT)            # test/
SRC = os.path.join(BASE, "blog_export.json")
IMG_SRC = os.path.join(BASE, "blog_images")   # where download_blog_images.py saved files
OUT = os.path.join(HERE, "out_blog")
OUT_POSTS = os.path.join(OUT, "posts")
OUT_IMAGES = os.path.join(OUT, "images")

DATE_PREFIX = re.compile(r'^\s*(\d{4})[.\-\s](\d{1,2})[.\-\s](\d{1,2})\b')
DATE_COMPACT = re.compile(r'^\s*(\d{4})(\d{2})(\d{2})\b')


# --------------------------------------------------------------------------
# HTML -> Markdown
# --------------------------------------------------------------------------
class MdConverter(HTMLParser):
    INLINE_SKIP = {"span", "font", "figure", "figcaption"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []          # list of block strings
        self.buf = []          # current inline text buffer
        self.list_stack = []   # ('ul'|'ol', counter)
        self.in_pre = False
        self.in_code = False
        self.link_href = None
        self.link_text = []
        self.in_table = False
        self.table_rows = []   # list of rows; row = list of cell strings
        self.cur_row = None
        self.cell_buf = None   # when set, capture into cell instead of buf

    # -- helpers -----------------------------------------------------------
    def _emit_block(self, s):
        s = s.rstrip()
        if s:
            self.out.append(s)

    def _flush_para(self, prefix=""):
        text = "".join(self.buf).strip()
        self.buf = []
        if text:
            if self.list_stack:
                indent = "  " * (len(self.list_stack) - 1)
                kind, cnt = self.list_stack[-1]
                bullet = "- " if kind == "ul" else ("%d. " % cnt)
                self._emit_block(indent + bullet + text)
            else:
                self._emit_block(prefix + text)

    def _add(self, text):
        if self.cell_buf is not None:
            self.cell_buf.append(text)
        elif self.link_href is not None:
            self.link_text.append(text)
        else:
            self.buf.append(text)

    # -- parser callbacks --------------------------------------------------
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in self.INLINE_SKIP:
            return
        if tag == "br":
            self._add("  \n")
        elif tag in ("p", "div"):
            self._flush_para()
        elif tag in ("strong", "b"):
            self._add("**")
        elif tag in ("em", "i"):
            self._add("*")
        elif tag == "u":
            self._add("<u>")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush_para()
            n = int(tag[1])
            self._pending_head = "#" * n + " "
            self.buf.append(self._pending_head)
        elif tag == "a":
            self.link_href = a.get("href", "")
            self.link_text = []
        elif tag == "ul":
            self._flush_para()
            self.list_stack.append(["ul", 0])
        elif tag == "ol":
            self._flush_para()
            self.list_stack.append(["ol", 0])
        elif tag == "li":
            self._flush_para()
            if self.list_stack:
                self.list_stack[-1][1] += 1
        elif tag == "blockquote":
            self._flush_para()
            self._blockquote = True
        elif tag == "hr":
            self._flush_para()
            self._emit_block("---")
        elif tag in ("code",):
            self.in_code = True
            self._add("`")
        elif tag == "pre":
            self._flush_para()
            self.in_pre = True
            self._emit_block("```")
        elif tag == "table":
            self._flush_para()
            self.in_table = True
            self.table_rows = []
        elif tag == "tr" and self.in_table:
            self.cur_row = []
        elif tag in ("td", "th") and self.in_table:
            self.cell_buf = []

    def handle_endtag(self, tag):
        if tag in self.INLINE_SKIP:
            return
        if tag in ("p", "div"):
            self._flush_para()
        elif tag in ("strong", "b"):
            self._add("**")
        elif tag in ("em", "i"):
            self._add("*")
        elif tag == "u":
            self._add("</u>")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush_para()
        elif tag == "a":
            txt = "".join(self.link_text).strip()
            href = self.link_href or ""
            self.link_href = None
            if href and txt:
                if txt == href:
                    self._add("<%s>" % href)
                else:
                    self._add("[%s](%s)" % (txt, href))
            elif txt:
                self._add(txt)
        elif tag in ("ul", "ol"):
            if self.list_stack:
                self.list_stack.pop()
            self._flush_para()
        elif tag == "li":
            self._flush_para()
        elif tag == "blockquote":
            self._blockquote = False
            self._flush_para()
        elif tag == "code":
            self.in_code = False
            self._add("`")
        elif tag == "pre":
            self._flush_para()
            self.in_pre = False
            self._emit_block("```")
        elif tag == "table":
            self._render_table()
            self.in_table = False
        elif tag == "tr" and self.in_table:
            if self.cur_row is not None:
                self.table_rows.append(self.cur_row)
            self.cur_row = None
        elif tag in ("td", "th") and self.in_table:
            cell = "".join(self.cell_buf or []).strip().replace("\n", " ")
            self.cell_buf = None
            if self.cur_row is not None:
                self.cur_row.append(cell)

    def handle_data(self, data):
        if not data:
            return
        data = data.replace("\xa0", " ")
        if self.in_pre:
            self._add(data)
        else:
            # collapse internal whitespace but keep single spaces
            self._add(re.sub(r"[ \t\r\n]+", " ", data))

    def _render_table(self):
        rows = [r for r in self.table_rows if r]
        if not rows:
            return
        ncol = max(len(r) for r in rows)
        rows = [r + [""] * (ncol - len(r)) for r in rows]
        lines = []
        header = rows[0]
        lines.append("| " + " | ".join(header) + " |")
        lines.append("| " + " | ".join(["---"] * ncol) + " |")
        for r in rows[1:]:
            lines.append("| " + " | ".join(r) + " |")
        self._emit_block("\n".join(lines))

    def result(self):
        self._flush_para()
        return "\n\n".join(self.out).strip()


def html_to_md(h):
    if not h:
        return ""
    c = MdConverter()
    c.feed(h)
    return c.result()


# --------------------------------------------------------------------------
# Page walking
# --------------------------------------------------------------------------
def sections_sorted(page):
    cl = page.get("canvasLayout") or {}
    secs = list(cl.get("horizontalSections") or [])
    if cl.get("verticalSection"):
        secs.append(cl["verticalSection"])

    def key(s):
        try:
            return float(s.get("id"))
        except (TypeError, ValueError):
            return 1e9
    return sorted(secs, key=key)


def image_name(path):
    # /sites/cmmas/Shared%20Documents/.../file.jpg -> file.jpg (url-decoded)
    from urllib.parse import unquote
    p = unquote(path or "")
    return os.path.basename(p)


def page_blocks(page):
    """Yield ('md', text) or ('img', filename) in document order."""
    for sec in sections_sorted(page):
        for col in sec.get("columns") or []:
            for wp in col.get("webparts") or []:
                t = wp.get("@odata.type")
                if t == "#microsoft.graph.textWebPart":
                    md = html_to_md(wp.get("innerHtml") or "")
                    if md:
                        yield ("md", md)
                elif t == "#microsoft.graph.standardWebPart":
                    srcs = (((wp.get("data") or {})
                             .get("serverProcessedContent") or {})
                            .get("imageSources") or [])
                    for s in srcs:
                        val = s.get("value")
                        if val:
                            low = val.lower()
                            if "/_layouts/" in low or "visualtemplate" in low:
                                continue  # system template placeholder, skip
                            yield ("img", image_name(val))


def parse_date(title, created):
    t = title or ""
    m = DATE_PREFIX.match(t) or DATE_COMPACT.match(t)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1900 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31:
            return "%04d-%02d-%02d" % (y, mo, d)
    c = (created or "")[:10]
    return c if re.match(r"\d{4}-\d{2}-\d{2}", c) else ""


def strip_md(md):
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", md)      # images
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)    # links -> text
    s = re.sub(r"[#>*`_|>-]+", " ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def main():
    if not os.path.exists(SRC):
        print("ERROR: source not found:", SRC)
        sys.exit(1)
    with open(SRC, "r", encoding="utf-8") as f:
        data = json.load(f)
    pages = data.get("value") or []

    os.makedirs(OUT_POSTS, exist_ok=True)
    os.makedirs(OUT_IMAGES, exist_ok=True)

    # sort by date for stable per-day sequence numbering
    prepared = []
    for p in pages:
        title = (p.get("title") or "").strip()
        if title.lower() == "home":
            continue
        date = parse_date(title, p.get("createdDateTime"))
        prepared.append((date, title, p))
    prepared.sort(key=lambda x: (x[0], x[1]))

    index = []
    used_ids = {}
    seq_by_date = {}
    all_images = set()

    for date, title, p in prepared:
        d = date or "0000-00-00"
        seq_by_date[d] = seq_by_date.get(d, 0) + 1
        pid = "%s-%02d" % (d, seq_by_date[d])
        while pid in used_ids:  # safety
            seq_by_date[d] += 1
            pid = "%s-%02d" % (d, seq_by_date[d])
        used_ids[pid] = True

        parts = []
        imgs = []
        for kind, val in page_blocks(p):
            if kind == "md":
                parts.append(val)
            else:
                imgs.append(val)
                all_images.add(val)
                parts.append("![](images/%s)" % val)
        body = "\n\n".join(parts).strip() + "\n"

        with open(os.path.join(OUT_POSTS, pid + ".md"), "w", encoding="utf-8") as f:
            f.write(body)

        excerpt = strip_md("\n".join(x for k, x in
                                     [(k, v) for k, v in page_blocks(p) if k == "md"]))[:120]
        search_text = strip_md(body)[:2000]
        index.append({
            "id": pid,
            "title": title,
            "date": date,
            "excerpt": excerpt,
            "searchText": search_text,
            "images": len(imgs),
            "webUrl": p.get("webUrl", ""),
        })

    index.sort(key=lambda r: (r["date"], r["id"]), reverse=True)
    with open(os.path.join(OUT, "blog-index.json"), "w", encoding="utf-8") as f:
        json.dump({"posts": index}, f, ensure_ascii=False, indent=2)

    # copy images if downloaded
    copied = 0
    missing = []
    if os.path.isdir(IMG_SRC):
        import shutil
        have = {}
        for fn in os.listdir(IMG_SRC):
            have[fn.lower()] = fn
        for name in sorted(all_images):
            src = have.get(name.lower())
            if src:
                shutil.copy2(os.path.join(IMG_SRC, src),
                             os.path.join(OUT_IMAGES, name))
                copied += 1
            else:
                missing.append(name)
    else:
        missing = sorted(all_images)

    print("posts written:", len(index))
    print("unique images referenced:", len(all_images))
    print("images copied:", copied)
    print("images missing (not yet downloaded):", len(missing))
    if missing[:5]:
        print("  e.g.", [ascii(m) for m in missing[:5]])
    print("output dir:", OUT)


if __name__ == "__main__":
    main()
