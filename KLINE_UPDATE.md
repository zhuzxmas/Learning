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

#### 例：新增一只股票（如 贵州茅台 600519）

> 最简单的方式是在 **a.cnmas.top →「股票基本面」→ 设置** 里点「＋ 添加股票」，
> 然后直接点该股行的 **「下载 kline」** 链接下载——前端会自动生成链接，
> **无需**再跑本脚本。下面是命令行方式，适合批量或无浏览器界面的场景。

1. 先在 OneDrive 的 `Apps/StockBatchTracker/stock_list.csv` 末尾加一行代码：

   ```
   "Title","Modified"
   603259
   ...（原有的股票）...
   600519      ← 新增这一行，只填 6 位代码
   ```
   > 脚本自动判断沪/深：6 开头→上海 .SH，其它→深圳 .SZ。

2. 直接运行（不加 `--all`），脚本会自动识别"csv 里有、kline 里没有"的新股：

   ```bash
   python kline_manifest.py
   ```

   输出只会列出新股一条：

   ```
   Loaded 35 stock codes from stock_list.csv.
   Found 34 existing kline files.

   1 kline file(s) to download (end=20260729, lmt=1800):

     600519.SH.txt
       https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&...
   ```

3. 打开 `kline/_manifest.html`，只下载这一条，另存为 `600519.SH.txt` 上传到 `kline/`。

> 注意：命令里**不需要**输入股票代码；代码是加在 `stock_list.csv` 里的，
> 脚本靠对比自动找出新股。

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
| 新增单只股票 | a.cnmas.top 设置里「添加」后点该行「下载 kline」，无需脚本 |
| 新增股票（命令行） | `python kline_manifest.py`（不加 `--all`），只补新股 |
| 刷新股价到最近 | `python kline_manifest.py --all`，重下全部 |
| 财务报表 / 分红 | 无需手动，云端实时抓取 |

## 相关文件

- `kline_manifest.py` — 生成下载清单
- `finance_batch_personal.py` — 季度批处理，读取 `kline/{code}.txt`
- OneDrive 目录：`Apps/StockBatchTracker/kline/`
</content>
</invoke>
