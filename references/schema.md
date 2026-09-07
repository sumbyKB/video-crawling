# 归档 JSON v2 字段口径（schemaVersion: 2）

本文档描述 `$SKILL_DIR/data/scans/<handle>/<YYYYMMDD-HHMM>.json` 的完整字段定义，供：
- 下游工具（如 tiktok-account-audit）对接时对齐口径
- 排查数据问题时人工核对

## 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `schemaVersion` | number | 恒为 `2`。解析前先校验它，v1 无增量对比字段 |
| `capturedAt` | string | ISO 8601 UTC（如 `2026-09-01T10:09:00.000Z`）。**增量对比以此字段定新旧，与文件名/参数顺序无关** |
| `source` | string | 数据来源描述，恒含 `api/post/item_list intercepted via CDP` |
| `requestedCount` | number | 请求条数；缺省 20，scan.js 上限 200 |
| `handle` | string | 小写化的 handle（无 `@`） |
| `uniqueId` / `nickname` | string | 页面 rehydration JSON 里取到的真实 id / 昵称；取不到时回退 handle |
| `profileUrl` | string | `https://www.tiktok.com/@<uniqueId>` |
| `verified` | boolean | 认证标记 |
| `bio` | string \| null | 主页签名 |
| `profileStats` | object | `{ followerCount, followingCount, heartCount, videoCount }`，任一项页面没给就是 `null`——**渲染时省略，不要写 0** |
| `totalItems` | number | 滚动期间捕获的原始条目数（含重复） |
| `unique` | number | 去重后实有条数 |
| `pinnedCount` | number | 本次样本内 `isPinned=true` 的条数 |
| `warningCode` | string \| null | `PARTIAL_COUNT(got:X,wanted:Y)` 表示实有条数少于请求条数；非失败，见 SKILL.md 处理规则 |
| `videos` | array | 视频记录，**成功输出的判据就是本字段存在**（错误对象没有它） |

## videos[] 每条字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `rank` | number | 从 1 起，按 API 返回顺序（置顶会自然浮在前面，与 App 内主页网格一致） |
| `id` | string | 视频数字 ID，**跨次对比的唯一键** |
| `url` | string | `https://www.tiktok.com/@<uniqueId>/video/<id>` |
| `publishedAt` | string \| null | UTC+8 的 `YYYY-MM-DD HH:mm`（前端展示常再截短为 `MM-DD HH:mm`） |
| `createTime` | string \| null | 原始 epoch 秒，字符串形式，供下游自行换算时区 |
| `durationSec` | number \| null | 秒；>60 建议渲染为分秒 `3:05` |
| `hashtags` | string[] | 已去重，取自 `textExtra[].hashtagName` |
| `musicTitle` | string \| null | 背景音乐名 |
| `commerceHint` | boolean | `isAd || commerceInfo` 任一为真即 true。**语义是"疑似带货"，接口信号而非精确事实** |
| `playCount` / `likeCount` / `commentCount` / `shareCount` / `collectCount` | number | `stats.*`；`likeCount` 对应接口的 `diggCount` |
| `isPinned` | boolean | 接口 `isPinnedItem` 字段，独立于 rank 排序单独标记 |
| `desc` | string | 视频文案，源数据截断到 120 字符 |

## 错误对象

失败时 stdout 是 `{ schemaVersion: 2, handle, error, detail, hint }`，**没有 `videos` 字段**；进程退出码恒为 0，消费方必须靠字段判错而不是 exit code。

错误码语义与处置动作见 SKILL.md「失败处理」表、`troubleshooting.md` 详解。

## 与下游工具的字段对齐

- **tiktok-account-audit**：默认取样 50 条、要求置顶单独标记。本 schema 的 `isPinned` 独立布尔 + 「拉 N 条」参数（`scan.js <handle> 50`）就是为这个口子留的
- **compare.js**：按视频 `id` 精确匹配跨次对齐；`capturedAt` 决定新旧；两次 `requestedCount` 不同时会在输出里警告总量对比仅供参考
- **to-csv.js**：CSV 列序 = 序号、视频ID、视频链接、发布时间、时长秒、话题标签、音乐、播放量、点赞、评论、分享、收藏、置顶、疑似带货、描述；输出带 BOM 的 UTF-8（Excel 中文直接双击可开），末行附总计

## 留档命名

`<handle>/<YYYYMMDD-HHMM>.json`，时间戳取抓取当下时刻。同一 handle 的所有档案按文件名即时间排序；「上次档案」= `capturedAt` 早于本次且最近的那份。
