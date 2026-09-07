---
name: videocrawling
description: 抓取 TikTok 达人近期视频数据（播放量、点赞、分享、评论、收藏、时长、话题标签、置顶状态）+ 主页级指标（粉丝数、获赞、作品总数），自动留档到 data/scans/ 并支持与上次扫描自动增量对比。触发：用户发 TikTok 视频链接（tiktok.com/@handle/video/id）或 @handle，要求分析达人、拉最近视频、看播放量、「拉 N 条」「对比上次」「导出 CSV」「统计话题标签」「看趋势」。Use when the user sends a TikTok video/profile link and asks for a creator's recent video stats. Chrome on port 9223 is auto-launched by this skill when missing.
description_zh: 抓取 TikTok 达人近期视频数据（播放量、点赞、分享、评论、收藏、时长、话题标签、置顶状态）+ 主页级指标（粉丝数、获赞、作品总数），自动留档并支持与上次扫描增量对比。触发：用户发 TikTok 视频链接或 @handle 并要求分析达人、拉最近视频、看播放量、拉 N 条、对比上次、导出 CSV。Chrome 在 9223 端口缺失时由本 skill 自动拉起，无需手动。
---

# TikTok 达人近期视频抓取 v2

## 何时使用（Trigger）

满足任一即触发本 skill：

- 用户发来 TikTok **视频链接**：`https://www.tiktok.com/@handle/video/<id>`，并附带分析诉求（「分析这个达人」「看看数据」「表现怎么样」）
- 用户发来 **@handle 或主页链接** + 要求拉视频数据：「拉最近 20 条」「拉 50 条」「看播放量」
- 用户点名使用短句功能：「**对比上次**」「**导出 CSV**」「**统计话题标签**」「**看趋势**」
- 一次发多个链接要求**批量分析**多个达人

**不适用（Do not use）**，遇到时向用户说明并停止：

- 抖音 / 小红书 / YouTube 等其它平台（本 skill 只支持 tiktok.com）
- 拉取**评论内容、粉丝列表、直播间数据**、广告后台数据（接口只覆盖主页视频列表与主页指标）
- 用户只想解析单条视频的内容/文案，不关心达人维度数据

## 环境要求

- Node.js 22+（`scan.js` 依赖全局 `WebSocket`，旧版会报 FATAL；装了新版 Claude Code / WorkBuddy 一般就满足）
- Google Chrome（启动器自动探测安装路径，探测不到才问一次并记住）
- 专用 Chrome（9223 端口、独立 profile，与日常浏览器隔离）——**缺失时由本 skill 自动拉起**，见标准流程第 2 步；macOS/Linux 用 `start-tiktok-chrome.sh`

## 路径常量（自适应两个 agent）

本 skill 可能装在两个位置之一，**每条命令执行前先解析 `SKILL_DIR`**（不要写死 agent 名）：

- Claude Code：`$USERPROFILE/.claude/skills/videocrawling/`
- WorkBuddy：`$USERPROFILE/.workbuddy/skills/videocrawling/`

```bash
SKILL_DIR="$USERPROFILE/.workbuddy/skills/videocrawling"
[ -d "$SKILL_DIR" ] || SKILL_DIR="$USERPROFILE/.claude/skills/videocrawling"
[ -d "$SKILL_DIR" ] || { echo "skill 目录不存在，请确认安装位置"; exit 1; }
echo "SKILL_DIR=$SKILL_DIR"
```

后续所有命令统一用 `$SKILL_DIR/`。
- 数据留档根目录：`$SKILL_DIR/data/scans/`（随安装位置走，不在仓库里写死盘符）
- ⚠️ 所有命令一律用 `$USERPROFILE` 形式，**禁用 `$HOME` 或 `~/` 开头的路径**：部分机器设了 MSYS_NO_PATHCONV=1 禁用路径转换，`/c/Users/...` 会被 Windows 程序解析成不存在的 `C:\c\Users\...`。实测 `$USERPROFILE` 在转换开与关两种模式下均可用

## 标准流程

### 1. 提取 handle
从链接取 `@` 后面那段；scan.js 自己也能接受完整 URL / @handle / 纯 handle。

### 2. 检查专用 Chrome
```bash
node -e "const s=require('net').Socket();s.setTimeout(2000);s.on('connect',()=>{console.log('OK');s.destroy();process.exit(0)});s.on('error',()=>{console.log('DOWN');process.exit(1)});s.on('timeout',()=>{console.log('DOWN');process.exit(1)});s.connect(9223,'127.0.0.1')"
```
- 输出 `OK` → 直接跳到第 3 步
- 输出 `DOWN` → **自动拉起**（不要让用户手动双击）：

```bash
powershell.exe -NoProfile -Command '$sd="$env:USERPROFILE\.workbuddy\skills\videocrawling"; if(!(Test-Path $sd)){$sd="$env:USERPROFILE\.claude\skills\videocrawling"}; Start-Process -FilePath "$sd\start-tiktok-chrome.bat"'
```
注意：不要用 `cmd //c start` 形式——Git Bash 会吃掉引号和反斜杠导致静默失败；PowerShell 这条已实测通过。
然后轮询最多 6 次（每次 sleep 5 秒后再跑一次端口检查），任一次输出 `OK` 即继续。
6 次后仍 `DOWN` 才降级为人工提示：「请双击 `$SKILL_DIR/`（上方解析结果，WorkBuddy 在 .workbuddy\skills\videocrawling\，Claude Code 在 .claude\skills\videocrawling\）里的 start-tiktok-chrome.bat」

### 3. 抓取并留档（临时文件 → 验错 → 归档）
```bash
node $SKILL_DIR/scripts/scan.js <handle> [条数] > /tmp/scan-tmp.json 2>/tmp/scan-log.txt
grep -q '"videos"' /tmp/scan-tmp.json || { cat /tmp/scan-log.txt /tmp/scan-tmp.json; 按「失败处理」表的 error 码行动; }
```
成功（输出含 `"videos"` 字段；错误对象没有它）才归档：
```bash
mkdir -p "$SKILL_DIR/data/scans/<handle>"
mv /tmp/scan-tmp.json "$SKILL_DIR/data/scans/<handle>/<YYYYMMDD-HHMM>.json"
```
时间戳用当下时刻。**每次成功抓取都必须归档，先归档再渲染输出。**

### 4. 增量对比（有历史档案时自动做）
```bash
ls -1 "$SKILL_DIR/data/scans/<handle>"/*.json
```
若除本次新档外还有更早的档案：取 `capturedAt` 最近早于本次的那份跑：
```bash
node $SKILL_DIR/scripts/compare.js <上次档案> <本次档案>
```
把 stdout 的 markdown 小节**原样接在主表格后面**。只有一个档案则跳过此步。

## 示例（Examples)

### 例 1：单达人扫描（最常见的完整输入→输出）

用户输入：
> 分析这个达人，拉最近 20 条视频数据
> https://www.tiktok.com/@katmndzonig/video/7671936325502749973

期望输出（数字示意）：
> 达人：[Kat Mendoza](https://www.tiktok.com/@katmndzonig)（@katmndzonig）✅认证 ｜ 粉丝 1.82万 ｜ 获赞 48.18万 ｜ 作品 1806 条
>
> | # | 视频 | 发布时间 | 时长 | 播放 | 点赞 | 评论 | 分享 | 收藏 | 置顶 | 描述 |
> |---:|---|---|---:|---:|---:|---:|---:|---:|:---:|---|
> | 1 | [035988](https://www.tiktok.com/@katmndzonig/video/…) | 07-03 10:24 | 0:18 | 14.2万 | 2,462 | 56 | 89 | 112 | ✅ | How I style… |
>
> 样本 20 条 ｜ 总播放 87.4万 ｜ 总点赞 3.1万 ｜ 置顶 2 条 ｜ 话题标签 9 个

### 例 2：「拉 50 条」
在上下文里直接说「拉 50 条」→ 对同一 handle 执行 `scan.js <handle> 50`，归档后按标准格式重出表格。

### 例 3：批量两达人
用户一次发两个链接 → 逐个顺序执行完整流程（各自留档+对比），中间 `sleep $((2 + RANDOM % 3))`，最后附跨账号对比表（见「多达人批量」）。

### 例 4：二次扫描自动对比
同一 handle 第二次扫描 → 主表格后自动接上 compare.js 的输出：

> ### 与上次扫描相比
> 上次：**2026-09-01 10:09**（样本 20 条） → 本次：**2026-09-07 15:30**（样本 20 条）
> **粉丝变化**：18,200 → 18,455（+255，+1.4%）
> | # | 视频链接 | 发布时间 | 播放量 | Δ播放 | 点赞 | Δ点赞 | 备注 |
> |---:|---|---|---:|---:|---:|---:|---|
> | 1 | [035988](…) | 07-03 10:24 | 156,200 | +12,000 (+8.3%) | 2,462 | +180 (+7.9%) | 📌 |
> | 5 | [771203](…) | 08-28 19:02 | 9,880 | — | 512 | — | 🆕 |

## 成功标准（Success Criteria）

一次合格的执行，全部满足才算完成：

1. **表格完整**：主表含 11 列（#、视频、发布时间、时长、播放、点赞、评论、分享、收藏、置顶、描述），视频列是可点击的尾号超链，数字用中文缩写（1.41万）
2. **达人行完整**：第一行达人名超链 + 主页指标；字段为 null 时省略该项而不是写 0
3. **已留档**：每次成功抓取都在 `$SKILL_DIR/data/scans/<handle>/<YYYYMMDD-HHMM>.json` 生成新档案，先归档后渲染
4. **增量对比**：该 handle 有历史档案时，输出末尾自动附「与上次扫描相比」小节（原样引用 compare.js stdout）
5. **失败可见**：任何失败都按「失败处理」错误码表给出明确下一步并告知用户，绝不静默输出空表或编造数据
6. **汇总行**：表格后附 样本 N 条 ｜ 总播放、总点赞、置顶数、hashtag 个数

## 失败处理（错误码驱动）

scan.js 失败时 stdout JSON 带 `error` 字段（schemaVersion 2）。按码行动（详见 references/troubleshooting.md）：

| error 码 | 含义 | 动作 |
|---|---|---|
| `INVALID_HANDLE` | handle 解析失败 | 向用户确认链接/handle 写法 |
| `CHROME_NOT_REACHABLE` | 9223 不通 | 回第 2 步走自动拉起流程 |
| `CREATE_TARGET_FAILED` | 端口通但 CDP 拒绝开 tab | 让用户关掉专用 Chrome 窗口，重跑（会触发自动拉起） |
| `NAV_FAILED_OR_CAPTCHA` | 页面没加载出/滑块验证码 | 请用户在专用 Chrome 手动打开该达人主页完成验证，回来重跑 |
| `EMPTY_RESULT_LIKELY_MS_TOKEN` | 页面在但 0 条数据 | 一句话告知：「msToken 大概率过期了，请在专用 Chrome 里刷新任意一个达人主页，然后告诉我重跑」。若是全新 profile 则还需登录 TikTok |
| `FATAL` | 其它异常 | 看 detail 重试 1 次；仍失败原样报告 detail |

warningCode `PARTIAL_COUNT(got:X,wanted:Y)` 不是失败：照常输出实有的 X 条并注明「达人在 Period 内只有 X 条或滚动未触发更多分页」。缺口超过 30%（要 50 只拿到 32 这种）时重跑 1 次，两次一致就如实展示。

脚本自身不做跨次重试之外的魔法；同一个 handle 连续两次同码失败就停下问人，不要循环空转。

## 按需短句

| 用户说 | 动作 |
|---|---|
| 「拉 50 条」（任意 N） | `scan.js <handle> 50` |
| 「导出 CSV」 | 对该 handle 最新档案跑 `to-csv.js <档案>`，生成的 .csv 在同目录，告知文件路径 |
| 「统计话题标签」 | 读最新档案 videos[].hashtags 做频次聚合，输出 top10 表格（标签、出现次数、对应播放量合计） |
| 「看趋势」 | 按 capturedAt 列出该 handle 全部档案的日期/粉丝数/总播放一张趋势表 |

## 多达人批量

去重 handle 后**逐个顺序执行**完整标准流程（含各自留档与增量对比）。两个 handle 之间停顿 `sleep $((2 + RANDOM % 3))` 秒——单 Chrome 会话并发抢请求容易招风控。
最后附跨账号对比表，「达人」列同样用主页超链：

| 达人 | 粉丝 | 样本 | 总播放 | 最高单条 | 置顶 |
|---|---:|---:|---:|---:|---:|

## 重要约束
- **不要绕过验证码**：遇到滑块验证码就停，提示用户
- **不要在专用 Chrome 里操作用户已有标签**：脚本只创建后台 tab，用完关闭
- **不要请求用户的 TikTok 密码**：登录态由用户自己在专用 Chrome 里维护
- **data/scans/ 不进 git**：属业务数据

## 参考文件（References）

- `references/schema.md` — 归档 JSON v2 完整字段口径（含与下游 tiktok-account-audit 的字段对齐说明）、compare.js / to-csv.js 的输出结构
- `references/troubleshooting.md` — 错误码详解、安装与运行 FAQ、9223 端口排查
