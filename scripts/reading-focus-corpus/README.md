# 辅助阅读真实页面样本

`manifest.json` 是待采集页面清单，不是已完成的模型测试结果。初始包含 15 个页面：重点覆盖 OpenAI 研究 HTML，同时保留用户报告、既有回归文章、研究目录和 PDF 支持边界。OpenAI 候选依据见 [研究记录](../../docs/research/reading-focus-openai-samples.md)。

新增 URL 时，在清单中增加一个对象，填写唯一 `id`、完整 `url`、`category` 和 `reasons`。`reasons` 写明要观察的具体问题，例如目录重复、图注混入、条件关系或无正文提示。PDF、目录页和普通文章应分别判断，不应混合计算一个质量分数。

## 导入用户本地案例

在项目根目录执行：

```powershell
node scripts/reading-focus-corpus/import-user-cases.mjs
```

默认只读 `C:/Users/xiao_/Desktop/测试用例` 中的 `.txt` 文件，输出到项目忽略目录 `output/reading-focus-corpus/user/`。可指定其他来源和输出目录：

```powershell
node scripts/reading-focus-corpus/import-user-cases.mjs "C:/path/to/cases" "output/reading-focus-corpus/user"
```

新增本地样本只需在来源目录新增 `.txt`，建议格式如下。输入中 `PARAGRAPHS_JSON_DATA=` 后保留完整 JSON 数组，输出保留 WorkOS 原始 JSON。没有输入或没有返回的案例也可以导入，缺失状态会明确记录。

```text
网址：https://example.com/article
描述：可选的观察或问题
输入：完整提示词……
PARAGRAPHS_JSON_DATA=[{"id":"p0","text":"Exact original paragraph."}]

输出：{"paragraphs":[{"id":"p0","groups":[]}]}
```

导入器保存原始文件字节、源路径和 SHA-256。每份原文使用内容摘要组成目录名；同一个文件后来发生变化时，会留下新的目录，不覆盖旧版原文。`index.json` 是本次扫描的索引，旧版本目录继续保留。来源目录中的文件不会修改，也不会沿符号链接扫描其他位置。

每个案例目录可能包含：

- `raw.txt`：用户本地原始记录的完整字节副本。
- `prompt.txt`、`input-json.txt`：记录中分离出的输入和段落 JSON 原文。
- `snapshot.json`：只有完整输入可以严格解析且段落 ID 不重复时才生成；标题未知时留空。
- `response-raw.txt`、`response.json`：用户提供的返回原文和可准确解析的 JSON。
- `provenance.json`：来源、解析状态、缺失内容和必要的文本精确匹配诊断。

导入器不会修补非法 JSON、改变引号或猜测缺失段落。复制后的内容损坏不能直接证明插件当时发送了损坏的数据。尤其应区分“用户从界面复制的输入”与“独立记录的实际请求”。

## 证据如何区分

本目录导入脚本不访问网络、不读取连接凭据、不创建 WorkOS 会话。导入的 `response` 只标为用户提供的历史 WorkOS 回复，不冒充这次工具发起的真实测试。

后续采集与真实调用需要另外记录：采集时间和最终 URL、页面原始 HTML/可见文本、实际抽取快照、实际发送提示词、WorkOS 原始返回、远端任务标识、耗时及失败阶段。先确认抽取正文完整，再评估返回的语义选择，最后检查页面高亮；任何一步未实际运行都应注明。

导入器的 `exactTextDiagnostics` 只检查 ID、片段能否在原文精确找到及顺序。它不代替生产解析器，不判断英文关系分类正确，也不提供模型准确率。手工参考、模拟返回、用户历史返回与新发起的真实调用需保持不同来源标记。

## 采集与重放

```powershell
node scripts/capture-reading-focus-corpus.mjs --url https://openrouter.ai/docs/guides/overview/principles --id openrouter-principles --browser-channel chrome
```

每次采集保存到 `output/reading-focus-corpus/captures/<id>/<时间>/`，历史不覆盖。文件包括实际渲染 HTML、正文快照、生产提示词、根容器审计、可见正文和截图。OpenAI 自动浏览器若遇到验证页会记为失败，不会当成正文或自动绕过。采集时间包含编译和浏览器启动，不能当作模型耗时。

`--html 已保存的rendered.html` 可离线重放，并禁止外部请求；证据类型明确记为 `saved-rendered-html-replay`，与真实网页访问分开。`openai-excerpts.json` 是从六个官方页面人工选出的14段原文，只用于语义测试，不能用于证明插件已经完整提取这些网页。`experimental-boundaries.txt` 是未合入正式插件的实验提示词补充。

## 单次真实调用

```powershell
node scripts/run-reading-focus-workos.mjs --snapshot output/reading-focus-corpus/captures/样本/时间/snapshot.json --id 样本 --connection-file output/private/workos.json
```

默认只准备输入。明确加 `--execute` 才创建会话并提交一次。连接读取本机文件或 `READING_WORKOS_CONNECTION_JSON` 环境变量，格式与页脉 `WorkosConnectionSettings` 一致；不要将连接文件提交到 Git。脚本本身不会读取浏览器凭据。

同一目标和相同提示词使用持久锁，改案例名称也不会重复提交。成功、失败和状态未确认都不会自动重试；状态未确认时保留会话标识以便核查。仅有正文但没有远端结束信号不算完成。超时只结束本地接收，不声称远端已停止。

`run.json` 保存正文、原始返回、生产解析结果、阶段时间和非敏感远端标识。`durationMs` 从开始创建远端会话计时，包含创建和等待；不包括本机加载生产模块的时间。`readyCount` 是原文定位通过数，包括合法空意群，并非语义正确率。

```powershell
node scripts/summarize-reading-focus-corpus.mjs
node --test scripts/reading-focus-corpus/runner.checks.mjs
node --test scripts/reading-focus-corpus/extraction.checks.mjs
```

汇总中的 `candidateAnalysis` 只对未确认结束的返回做离线诊断，不改变任务状态。完整研究判断另见 `docs/research/reading-focus-corpus-findings-2026-10-23.md`。浏览器回归需要已安装 Chrome 和本机 Playwright；它离线复现 MDX 段落、隐藏内容、控件和嵌套列表，不创建 WorkOS 会话。
