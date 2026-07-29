# 更新 kline（股价历史）数据

财务报表和分红由季度批处理**云端实时抓取**，无需手动维护。
只有 **kline 股价历史**需要手动更新，因为 EastMoney 的 `push2his` 接口
在 GitHub Actions / 云端 IP 上不可达，只能在浏览器里下载。

## 步骤

### 1. 生成下载清单（在能走公司代理的电脑上）

```bash
python kline_manifest.py           # 只生成"缺失"kline 文件的股票（补新增股票用）
python kline_manifest.py --all     # 为全部股票重新生成（定期刷新已有数据用）
LMT=1800 python kline_manifest.py  # 可选：控制取多少天，默认 1800
```

脚本会把清单写到 OneDrive 的 `Apps/StockBatchTracker/kline/`：

- `kline/_manifest.html` — 可点击的下载链接，每条都标注了要保存的文件名
- `kline/_manifest.csv`  — code,filename,url（备查/脚本用）

### 2. 浏览器里逐个下载

1. 打开 OneDrive 里的 `kline/_manifest.html`
   （必须用浏览器，因为只有浏览器能访问 push2his）
2. 逐条点链接 → **网页另存为** → 存成清单标注的文件名 `{code}.txt`
   （例如 `600104.SH.txt`）
3. 把文件上传/覆盖回 OneDrive 的 `Apps/StockBatchTracker/kline/` 目录

### 3. 无需再动批处理

季度批处理（GitHub Actions 或本地 `finance_batch_personal.py`）运行时会
自动读取最新的 `kline/{code}.txt`，重新计算价格区间并更新 `output/{code}.json`。

## 什么时候更新

| 场景 | 操作 |
|------|------|
| 新增股票 | `python kline_manifest.py`（不加 `--all`），只补新股 |
| 刷新股价到最近 | `python kline_manifest.py --all`，重下全部 |
| 财务报表 / 分红 | 无需手动，云端实时抓取 |

## 相关文件

- `kline_manifest.py` — 生成下载清单
- `finance_batch_personal.py` — 季度批处理，读取 `kline/{code}.txt`
- OneDrive 目录：`Apps/StockBatchTracker/kline/`
</content>
</invoke>
