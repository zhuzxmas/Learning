# 股票管理（增 / 删 / 更新）说明

「股票基本面」页面的**设置**面板可以增删股票、触发单只股票的批处理更新。
本文说明使用流程，以及首次启用「更新」按钮所需的一次性配置（GitHub PAT + Cloudflare 密钥）。

---

## 一、日常使用流程

1. 打开 a.cnmas.top → 更多 →「股票基本面」→ 点右上「设置」
2. **添加股票**：点「＋ 添加股票」，输入 6 位代码（如 `600519`）→ 自动写入
   OneDrive 的 `Apps/StockBatchTracker/stock_list.csv`
   - 沪/深自动判断：6 开头→上海 `.SH`，其它→深圳 `.SZ`
   - 港股用 `H` 前缀（如 `H01548`）→ `.HK`
3. **更新个股**：点该股的「更新」→ 触发一次只跑这只股票的批处理
   - 股价（前复权日线）与财务数据均**云端自动获取**（腾讯行情），无需手动下载 kline
   - 若某次行情源暂时不可用，该股详情页顶部会提示，股价指标显示为上次数据
4. 几分钟后点面板外的「刷新」→ 新股（含价格区间）出现在页面

- **删除股票**：点该行「删除」并确认 → 从 `stock_list.csv` 移除，并删除它的
  `output/{code}.json` + `.html`，页面立即不再显示（kline / history 文件保留）。

> 说明：报表和分红是批处理运行时**云端实时抓取**的；只有 kline 价格需要你手动下载。
> 所以「添加」后一定要先下载 kline，再点「更新」，否则该股只有报表/分红、没有价格。
>
> 展示优化：页面默认**只下载当前选中那只股票**的明细，切换下拉框选其它股票时
> 才按需下载，并在浏览器本地缓存（localStorage，按文件修改时间自动失效）。

---

## 二、一次性配置：让「更新」按钮能触发 GitHub Action

「更新」按钮通过 `api.cnmas.top/trigger-stock`（Cloudflare Worker）触发仓库的
GitHub Action。Worker 需要一个 GitHub 令牌（PAT）才能触发。配置一次即可长期使用。

### 步骤 1：创建 GitHub Fine-grained PAT

1. 登录 GitHub → 右上头像 → **Settings**
2. 左侧最下 **Developer settings**
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
4. 按下面填写：

   | 字段 | 填写 |
   |------|------|
   | **Token name** | 例如 `family-tracker-dispatch` |
   | **Expiration** | 建议 `Custom` 选一年后；或 `No expiration`（更省事但安全性略低）|
   | **Resource owner** | 选你自己的账号 `zhuzxmas` |
   | **Repository access** | 选 **Only select repositories** → 勾选 **`zhuzxmas/Learning`** |

5. **Permissions** → 展开 **Repository permissions**，只需给一项：
   - **Contents** → 下拉选 **Read and write**
   > `repository_dispatch`（触发 Action）由 Contents: write 授权，无需其它权限。
   > 其余权限保持 `No access` 即可，越小越安全。

6. 拉到底 → **Generate token**
7. **立刻复制**生成的令牌（形如 `github_pat_xxxx…`）。页面一旦离开就再也看不到，
   丢了只能重建。

> 如果你的账号在某个组织下、fine-grained 受限，也可以改用
> **Tokens (classic)** → 勾选 **`repo`** 这个大类即可（权限更宽，够用但不够精细）。

### 步骤 2：把 PAT 存进 Cloudflare Worker 密钥

1. Cloudflare 仪表盘 → **Workers & Pages** → 打开你的 DeepSeek 那个 Worker
   （对外域名 `api.cnmas.top`）
2. **Settings** → **Variables and Secrets**（或 Variables）→ **Add** 一个 **Secret**：
   - **Variable name**：`GH_DISPATCH_TOKEN`（名字必须完全一致）
   - **Value**：粘贴步骤 1 复制的 PAT
   - 选择 **Encrypt** / Secret 类型
3. 保存

### 步骤 3：重新部署 Worker 代码

Worker 里已经加了 `/trigger-stock` 路由（见 `tools/deepseek-worker.js`）。把最新的
`tools/deepseek-worker.js` 全部内容：

1. Worker → **Edit code** → 全选删除旧内容 → 粘贴 `deepseek-worker.js` 全文
2. **Deploy**

### 步骤 4：部署前端

用最新的 `spending-tracker-public.zip`（或 `wrangler deploy`）部署站点，让页面带上
新的「设置」面板。

---

## 三、验证

1. 页面「设置」→ 添加一个测试代码 → 下载它的 kline → 点「更新」
2. 若提示「已提交…」即成功；到 GitHub 仓库 **Actions** 页应能看到一次
   `finance-quarterly action` 运行（由 `repository_dispatch` 触发）
3. 跑完后回页面「刷新」查看

### 常见报错
- **未授权 / 403**：当前登录的微信/微软账号不在 Worker 白名单里（`deepseek-worker.js`
  顶部 `ALLOWED_EMAILS`）。
- **服务端未配置 GH_DISPATCH_TOKEN / 500**：Worker 密钥没加成功，回到步骤 2。
- **GitHub 触发失败 / 502**：PAT 权限不足或已过期；确认 Contents: Read and write 且
  选对了 `zhuzxmas/Learning`，必要时重建 PAT。

---

## 相关文件
- `a_cnmas_top/Family-tracker/public/app.js` — 前端 `sbt*` 增删/更新逻辑
- `a_cnmas_top/Family-tracker/tools/deepseek-worker.js` — `/trigger-stock` 路由
- `.github/workflows/finance-quarterly.yml` — 读取 `client_payload.stock` → `STOCK_ONLY`
- `KLINE_UPDATE.md` — kline 数据下载说明
</content>
</invoke>
