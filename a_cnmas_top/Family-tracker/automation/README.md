# OneDrive 14 天摘要（GitHub Action）

每 ~14 天自动读取**期间发表的生活博客、贴吧新主题/新回复、旅行记录、AI 对话和日历记录**，
交给 **DeepSeek** 汇总成一份中文 Markdown，写回 OneDrive **博客文件夹的
`summaries/`** 子文件夹。旧博客在本期修改不会纳入；贴吧按活动时间筛选，旅行按实际旅行日期筛选。

个人 OneDrive 无法用 app-only，只能用委托授权 + refresh token。为免 PAT，滚动的
refresh token 加密存在 `rt.enc`（提交进仓库），每次运行自动刷新并用内置
`GITHUB_TOKEN` 提交回仓库。

---

## 文件

| 文件 | 说明 |
|---|---|
| `bootstrap.py` | **本地一次性**：登录拿首个 refresh token + 生成加密密钥和 `rt.enc` |
| `summarize.py` | 主脚本：认证+轮换 → 读近 14 天 → DeepSeek → 写回 `summaries/` |
| `requirements.txt` | 依赖：`requests`、`cryptography` |
| `rt.enc` | 加密的滚动 refresh token（由脚本维护，可提交） |
| `../../.github/workflows/summarize.yml` | 定时 + 手动触发的工作流 |

---

## 一、注册 Entra 应用（一次性）

1. Azure 门户 → **App registrations** → New registration。
2. **Supported account types** 选包含 **“Personal Microsoft accounts”** 的选项。
3. 注册后进入 **Authentication** → 打开 **Allow public client flows = Yes**。
4. **API permissions** → 加 delegated 权限 **Microsoft Graph → Files.ReadWrite.All**
   （`offline_access` 会由设备码流程自动带上）。
5. 记下 **Application (client) ID**。

## 二、本地拿首个 token（在**非公司网络**：家里 wifi / 手机热点）

```bash
cd spending-tracker/automation
pip install -r requirements.txt
python bootstrap.py <你的 client_id>
```

按提示打开链接、输入设备码、用**个人 Microsoft 账号**登录授权。成功后脚本会：
- 写出 `automation/rt.enc`；
- 打印要配置的 4 个值（client id / TOKEN_ENC_KEY / refresh token / DeepSeek key）。

> 公司电脑因 SSL 拦截可能登录失败，请用家庭网络或手机热点。

## 三、配置 GitHub 仓库

1. 新建/选一个仓库，把 **`spending-tracker/` 目录**和 **`.github/workflows/summarize.yml`**
   一起提交（保持本仓库现有的目录结构，即仓库根目录下有 `spending-tracker/` 和
   `.github/`）。**把 `automation/rt.enc` 也提交进去。**
2. 仓库 **Settings → Secrets and variables → Actions** 加 4 个 Secret：

   | Secret | 值 |
   |---|---|
   | `ONEDRIVE_CLIENT_ID` | 你的 client id |
   | `TOKEN_ENC_KEY` | bootstrap 打印的 Fernet 密钥 |
   | `ONEDRIVE_REFRESH_TOKEN` | bootstrap 打印的 refresh token（仅首次兜底） |
   | `DEEPSEEK_API_KEY` | 你的 DeepSeek key |

   > `TOKEN_ENC_KEY` 和明文 refresh token **绝不要**写进代码/仓库文件，只放 Secrets。
   > `rt.enc` 因为已用 `TOKEN_ENC_KEY` 加密，才可以安全提交。

3. **Settings → Actions → General → Workflow permissions** 设为
   **Read and write permissions**（让 `GITHUB_TOKEN` 能 push 回 `rt.enc`）。

## 四、验证

- **Actions** 标签 → 选 “OneDrive 14-day summary” → **Run workflow** 手动跑一次。
- 日志应显示找到的博客、贴吧、旅行、对话和日历数量，调用 DeepSeek，并写回
  `summaries/summary-YYYY-MM-DD.md`。
- 去 OneDrive 博客文件夹的 `summaries/` 看是否生成了摘要 `.md`。
- 仓库应出现一个 `chore: rotate OneDrive refresh token [skip ci]` 的自动提交
  （说明 `rt.enc` 已滚动）。

之后在北京时间每个偶数 ISO 周的周六早上自动运行（约 14 天一次）。因间隔远小于
refresh token 的 90 天滑动有效期，token 不会过期。

---

## 可选调整

- **看板范围**：环境变量 `SUMMARY_DAYS`（默认 14）。
- **模型**：`DEEPSEEK_MODEL`（默认 `deepseek-v4-flash`，可改 `deepseek-v4-pro`）。
- **重跑历史窗口**：手动运行工作流时可填写 `summary_end_beijing`，格式
  `YYYY-MM-DD HH:MM`；输出会覆盖该北京时间日期对应的总结文件。
- **打印发送内容**：`LOG_PROMPT=1` 时会把发给 DeepSeek 的完整 prompt（含博客/对话原文）
  打印到 Action 日志，默认关闭。公开仓库慎用（日志任何人可见）。
- **汇总重点**：改 `summarize.py` 里的 `SYSTEM_PROMPT`。
- **路径**：workflow 会用 `find` 自动定位仓库里任意位置的 `*automation*/summarize.py`，
  无需写死路径。例如本仓库实际布局为
  `a_cnmas_top/Family-tracker/automation/`，也能被自动找到。
  唯一要求：`.github/workflows/summarize.yml` 必须放在**仓库根目录**的 `.github/` 下。
