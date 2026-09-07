# TikTok 达人视频数据抓取工具（videocrawling skill）

> 给运营同事用的 TikTok 达人数据抓取工具。发一个视频链接，自动拉出该达人**近期 N 条视频**（默认 20，可说「拉 50 条」）的完整数据：
>
> - 每条视频：播放量、点赞、分享、评论、收藏、发布时间、时长、话题标签、**置顶状态**、疑似带货标记
> - 主页整体：粉丝数、获赞总数、作品总数
>
> 并会**自动留档**：每次抓取存成 JSON；同一达人第二次抓取时自动生成「与上次相比」的变化报告（播放/点赞涨跌、新视频 🆕、消失的视频 ⚠️、粉丝增减）。

## 它解决什么问题

TikTok 主页的视频列表接口需要签名（X-Bogus / X-Gnarly），直接调 API 会被拦。本工具通过**专用 Chrome 拦截 TikTok 自己发出的请求**，拿到完整签名后的真实数据——和你打开主页看到的一模一样。

```
专用 Chrome（start-tiktok-chrome.bat 启动，端口 9223，独立 profile）
  → 同事登录一次 TikTok（登录态长期保留）
同事在 Claude Code / WorkBuddy 里发视频链接
  → agent 加载本 skill
  → 连接 9223，后台 tab 打开达人主页，拦截 SPA 发出的 /api/post/item_list/ 响应
  → 解析出 N 条视频数据（含置顶状态）
  → 生成表格回给同事，并归档到 data/scans/
```

## 一次性安装（3 步，5 分钟）

**环境要求**：Windows / macOS / Linux，Node.js 22+（装了新版 Claude Code 就有），Google Chrome。

### 第 1 步：把本仓库整个复制到 skills 目录

拿到本文件夹（克隆或直接拷贝）后，整个复制为 **小写 `videocrawling`** 文件夹：

```bat
:: Windows（cmd）
xcopy /E /I VideoCrawling "%USERPROFILE%\.claude\skills\videocrawling"
```

```bash
# macOS / Linux
cp -R VideoCrawling ~/.claude/skills/videocrawling
```

装好后应是这样：

```
C:\Users\<你>\.claude\skills\videocrawling\
├── SKILL.md                      # skill 定义（触发条件 + 工作流 + 成功标准）
├── scripts\scan.js               # 抓取主脚本（CDP + 拦截 post/item_list）
├── scripts\compare.js            # 增量对比
├── scripts\to-csv.js             # 导出 Excel 可开的 CSV
├── references\schema.md          # 归档 JSON 字段口径
├── references\troubleshooting.md # 错误码详解 + 排错手册
├── start-tiktok-chrome.bat       # 专用 Chrome 启动器（Windows）
└── start-tiktok-chrome.sh        # macOS / Linux 启动器
```

> WorkBuddy 用户装到 `%USERPROFILE%\.workbuddy\skills\videocrawling\`，skill 会自适应。
>
> ⚠️ 从别人手里拿到的文件夹，如果里面有 `data\` 子目录，删掉再装——那是对方的抓取留档，不属于安装包。
>
> 开发者本机可用 Junction/Symlink 代替复制，改仓库即生效：
> `mklink /J "%USERPROFILE%\.claude\skills\videocrawling" D:\code\codeMy\VideoCrawling`

### 第 2 步：把启动器放桌面

复制 `start-tiktok-chrome.bat` 到桌面（macOS/Linux 用 `.sh`）。

### 第 3 步：首次启动 + 登录 TikTok

1. 双击桌面的 `start-tiktok-chrome.bat` → 弹出一个**新的 Chrome 窗口**（独立 profile，不影响日常浏览器）
2. 在这个新窗口里打开 `https://www.tiktok.com` **登录一次**
3. 登录后保持窗口开着

**安装完成！**

---

## 日常使用

1. 保持专用 Chrome 窗口开着（没开也没关系，agent 会**自动帮你拉起**）
2. 在 Claude Code 里发视频链接：

   ```
   分析这个达人，拉最近 20 条视频数据
   https://www.tiktok.com/@katmndzonig/video/7671936325502749973
   ```

3. 出表格后还可以继续说：
   - 「拉 50 条」—— 抓更多历史
   - 「对比上次」—— 重新生成与上次的变化报告
   - 「导出 CSV」—— 生成 Excel 双击就能开的表格文件
   - 「统计话题标签」—— 该达人最爱用的话题 top10
   - 「看趋势」—— 历次抓取的粉丝数/播放量走势表

**可以一次发多个链接**，agent 会按达人去重批量跑（自带防风控间隔）。

### 第一次用，验证一下

原样发这段话（换成任意 TikTok 链接都行）：

```
分析这个达人，拉最近20条视频数据
https://www.tiktok.com/@xxxxxx/video/1234567890123456789
```

正常的话会得到类似回复（数字为示意）：

> 达人：[Kat Mendoza](https://www.tiktok.com/@katmndzonig)（@katmndzonig）｜ 粉丝 1.82万 ｜ 获赞 48.18万 ｜ 作品 1806 条
>
> | # | 视频 | 发布时间 | 时长 | 播放 | 点赞 | … |
> |---|---|---|---|---|---|---|
> | 1 | [035988](…) | 07-03 10:24 | 0:18 | 14.2万 | 2,462 | … |

表格下面是汇总行；第二次扫同一达人时自动多一节「与上次扫描相比」的涨跌报告。

**没反应或报错** → 把报错原文发给 agent，它按错误码告诉你下一步（对照 `references/troubleshooting.md`）。

### 数据存在哪？

```
.claude\skills\videocrawling\data\scans\<达人handle>\<日期时间>.json
```

CSV 导出文件生成在同一目录。想重置数据直接删 `data` 文件夹即可。

---

## 常见问题（速查）

| 症状 | 处理 |
|---|---|
| 双击 .bat 没反应 / 找不到 Chrome | 按提示粘贴 chrome.exe 完整路径（只需一次，记住在 `chrome-path.txt`）；详见 references/troubleshooting.md |
| 「9223 端口没开」 | v2 里 agent 会自动拉起专用 Chrome；连它也没搞定再双击桌面 .bat |
| 抓出来 0 条 | msToken 过期（约 6–12 小时一轮）：专用 Chrome 里刷新任意达人主页后重跑；全新 profile 先确认登录过 |
| 影响日常 Chrome 吗 | 不会，独立 profile（`%USERPROFILE%\WorkBuddy\tiktok-chrome`）完全隔离 |
| 数据准吗 | 来自 TikTok 官方接口 `/api/post/item_list/`（浏览器自己发的带签名请求），非第三方估算；「疑似带货」来自接口广告信号，标注为疑似 |

完整排错手册（含 9223 端口占用、skill 未识别、macOS/Linux）见 **references/troubleshooting.md**。

---

## 技术说明

- **抓取方式**：agent 连接专用 Chrome 调试端口（9223），后台 tab 加载主页并拦截 SPA 请求响应；滚动页数按目标条数自适应
- **留档格式**：JSON 带 `schemaVersion/capturedAt/source` 元信息，增量对比按视频 ID 精确匹配，字段口径见 references/schema.md
- **置顶状态**：来自接口 `isPinnedItem` 字段，独立标记不依赖排序
- **边界**：不绕过验证码、不存密码、只读取公开数据
- **可对接**：归档 JSON 可直接喂给 tiktok-account-audit 等下游工具（默认取样 50 条、置顶单独标记，本工具的「拉 N 条」即为此预留）

## License

MIT
