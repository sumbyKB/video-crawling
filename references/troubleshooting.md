# 排错手册：错误码详解 + 安装运行 FAQ

SKILL.md 的「失败处理」表是行动索引；本文是每一条的**原理与深挖**，以及安装、端口、登录等常见问题。

## 一、scan.js 错误码详解

### `INVALID_HANDLE`
输入解析不出 handle。scan.js 接受三种形态：完整视频/主页链接、`@handle`、纯 handle。先自己确认链接没被聊天软件截断（常见：链接后面粘着中文标点）。

### `CHROME_NOT_REACHABLE`（9223 不通）
专用 Chrome 没启动或已退出。按 SKILL.md 第 2 步走自动拉起；连拉 6 次（约 30 秒）都失败再让用户手动双击 `start-tiktok-chrome.bat`。

### `CREATE_TARGET_FAILED`（端口通但开不了 tab）
通常上一个会话留下了僵尸 Chrome 窗口或 tab 数量异常。让用户**手动关掉那个专用 Chrome 窗口**，重跑——端口探测会变 DOWN，自动拉起流程会接手。

### `NAV_FAILED_OR_CAPTCHA`（页面加载不出 / 滑块验证码）
scan.js 会导航重试 3 次、每次轮询页面状态；检测到「Drag the slider」等验证码文案即停止（**本 skill 不绕过验证码**）。
处置：请用户在专用 Chrome 窗口里手动打开该达人主页，完成滑块验证后回来重跑。

### `EMPTY_RESULT_LIKELY_MS_TOKEN`（页面在但 0 条数据）
最常见错误。页面加载正常，但拦截不到 `/api/post/item_list/` 响应——几乎总是 **msToken 过期**（TikTok 约 6–12 小时轮换一次）。
处置话术：「msToken 大概率过期了，请在专用 Chrome 里刷新任意一个达人主页，然后告诉我重跑」。
若专用 Chrome 是全新 profile，先确认登录过 TikTok（主页数据对未登录账号也会限流）。

### `FATAL`
其它未归类异常，看 `detail` 字段。重试 1 次；仍失败把 detail 原样报给用户。

### `warningCode: PARTIAL_COUNT(got:X,wanted:Y)`（不是失败）
达人在 Period 内只有 X 条，或滚动未触发更多分页。照常输出 X 条并注明原因；缺口 >30% 时重跑 1 次，两次一致就如实展示。

### 熔断规则
同一个 handle **连续两次同码失败**就停下来问人，不要循环重试空转。

## 二、安装问题

### Claude Code 没识别到 skill
- 确认路径：`%USERPROFILE%\.claude\skills\videocrawling\SKILL.md` 存在（目录名小写 `videocrawling`，与 SKILL.md 里的 `name` 一致）
- 文件夹里不要有旧的 `data\` 残留干扰判断（不影响识别，但属于别人的业务数据，删掉）
- 在 Claude Code 里问：「你能看到 videocrawling 这个 skill 吗？」；看不到就重启 Claude Code

### 双击 .bat 没反应 / 找不到 Chrome
- 确认文件名是纯英文 `start-tiktok-chrome.bat`，右键 → 管理员身份运行试一次
- 启动器会自动探测 Chrome：标准安装目录（Program Files / Program Files (x86) / %LocalAppData%）→ 注册表 App Paths。全失败才提示输入 chrome.exe 完整路径（可直接把文件拖进窗口回车），路径记住在启动器旁的 `chrome-path.txt`；写错了删掉这个文件重来
- 命令行手动执行 `.bat` 看报错原文

### macOS / Linux
用 `start-tiktok-chrome.sh`：
```bash
chmod +x start-tiktok-chrome.sh
./start-tiktok-chrome.sh
```
Chrome 路径不对就编辑脚本里的 `CHROME` 变量。

## 三、运行问题

### 9223 端口被占用 / 状态检查
```bash
# Windows
netstat -ano | findstr :9223
taskkill /PID <PID> /F
# macOS / Linux
lsof -i :9223
kill <PID>
```
然后重新启动专用 Chrome。

### 抓出来 0 条 / 和浏览器里看到的不一致
按顺序排查（对应错误码 `EMPTY_RESULT_LIKELY_MS_TOKEN` 的线下版）：
1. 专用 Chrome 里打开 `https://www.tiktok.com`，确认右上角是**登录态**
2. 刷新任意达人主页（换 msToken）
3. 手动打开目标达人主页：弹验证码 → 关标签重开；显示「出错了」→ 刷新；正常显示视频网格 → 回 Claude 重跑
4. 还不行等 10–30 分钟（风控临时升级），或换网络环境（手机热点）

### 数据口径疑问
- 「疑似带货」是接口广告/商品信号字段的推断，**不是事实**，输出时保留"疑似"表述
- 数字与你手机上看到的不一致：TikTok 各端统计口径有延迟，以接口返回为准
- 字段含义、JSON 结构见 `schema.md`

### 会不会影响日常 Chrome？会不会弹调试授权框？
不会。专用 Chrome 用独立 profile（`%USERPROFILE%\WorkBuddy\tiktok-chrome`），与日常浏览器完全隔离；由 `.bat`/`.sh` 命令行启动并显式声明调试端口，不弹「允许调试」授权框。
