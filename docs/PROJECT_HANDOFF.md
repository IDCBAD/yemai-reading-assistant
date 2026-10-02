# 页脉项目交付与接管手册

> 当前事实基线：2026-09-21，`main`，代码版本 `0.6.1`
> 受众：第一次接触仓库、需要继续维护或开发的工程师与 Agent  
> 规则：本文是项目当前状态的首要入口；版本历史快照和专项协议按文中链接查阅。

## 1. 先读结论

页脉（Yemai）是一个 Chrome Manifest V3 Side Panel AI 阅读助手。它从当前网页、用户划词、文件和图片构造可追溯上下文，通过影刀 WorkOS Agent 完成连续对话，并把会话、来源、Agent 产物和阅读卡片保存为本地知识资产。

当前项目已经完成 v0.1～v0.6 的版本化实现；v0.6.1 在 v0.6.0 基础上合入侧边栏性能优化和独立生命周期诊断，作为下一轮体验优化的起点。

| 状态维度 | 当前事实 |
| --- | --- |
| 代码版本 | `0.6.1`，`package.json`、锁文件和生产 Manifest 一致 |
| 当前分支 | 本地 `main` |
| 当前提交 | 以 Git 标签 `v0.6.1` 指向的提交为准 |
| 工作区基线 | 性能优化已合入本地 `main`；远端提交与标签以 Git 查询为准 |
| 自动验证基线 | TypeScript 通过；66 个测试文件、353 项测试通过；生产构建、诊断构建和 ZIP 通过 |
| 本地主线 | v0.3～v0.6 的累计能力已合入 |
| 远端主线 | 完成本轮上传后应与 `v0.6.1` 同步，使用 Git 查询核对 |
| 固化版本标签 | `v0.6.1`；保留既有版本标签 |
| 当前安装包 | `yemai-reading-assistant-0.6.1-chrome.zip`；上传状态以 [Release](https://github.com/IDCBAD/yemai-reading-assistant/releases/tag/v0.6.1) 为准 |
| v0.6.1 安装包校验 | `SHA-256 0CE72BB968FA89A02920388F1401056B3485EDE5915BA00FF085757C5CCE1646` |
| v0.6.1 人工回归 | 本轮未新增真实 Chrome / WorkOS 人工回归；保留此前使用反馈，不将自动测试等同于人工验收 |
| 发布证据 | 核对 `v0.6.1` 标签、Release 页面中的 Chrome ZIP 与 SHA-256；构建成功本身不代表已发布 |

接手者不要把 `CHANGELOG.md` 中出现的版本段落自动理解成 GitHub Release。统一使用根目录 [CONTEXT.md](../CONTEXT.md) 定义的四级状态：**已实现、已验收、已合入、已发布**。

## 2. 产品边界

### 2.1 用户能做什么

- 在 Chrome Side Panel 中围绕阅读任务持续提问。
- 读取当前网页的标题、地址、结构和有限正文。
- 通过普通划词或 DOM 智能框选加入引用。
- 把页面、划词、文件和图片作为统一上下文项管理。
- 使用 WorkOS 官方 v1 或实验性内部 v2 通道获得流式回答。
- 在 Agent 工作期间继续发送问题，由每个会话的队列顺序执行。
- 查看 Mermaid、Agent 生成图片和文件产物。新增图片缩放拖动，以及 Markdown、静态 HTML、Excel、CSV、JSON、TXT 预览和独立预览标签页；用户已确认功能与原生工具栏方案，尚未正式发布，自动化验证使用合成文件，见 [产物在线预览](artifact-preview.md)。
- 创建会话分支、归档历史、全文搜索和精确定位消息。
- 把完整回答或回答中的划选片段收藏成独立收藏卡片。
- 在收藏列表多选问答，带入新会话后自行提问，或逐张新建到指定 Obsidian 问答目录（当前开发分支，待真实 Chrome 验证）。
- 导出/导入版本化本地备份，并把收藏卡片导出为 Markdown。

### 2.2 明确不做什么

- 不同步 WorkOS 远端历史，也不删除 WorkOS 远端会话或上传文件。
- 不提供账号系统、代理后端或云同步。
- 不在 Side Panel 关闭后恢复已断开的 SSE。
- 不执行网页正文中的指令；网页内容始终是不可信资料。
- 不保存或展示原始思维链、完整工具参数和工具输出。
- 不保证完整读取 X 首页时间线、Chrome 受限页面或所有动态站点。
- `memory` 和 `link` 目前只是上下文类型预留，没有创建入口和 Agent 传输映射。

更完整的产品规则见 [PRODUCT_SPEC.md](./PRODUCT_SPEC.md)。

## 3. 系统全景

```text
普通网页
  ↓
Content Script
页面元数据 · 正文抽取 · 普通划词 · 智能框选
  ↓
Background Service Worker
标签页定位 · 消息路由 · 待处理引用 · Side Panel 生命周期
  ↓
React Side Panel
会话 · 上下文工作台 · 队列 · 流式界面 · 阅读卡片
  ↓
WorkosTransport + WorkosFileUploader
Public v1 / Internal v2 · 公开上传 / 内部网页上传
  ↓
WorkOS Agent
正文增量 · 工具安全投影 · 交互表单 · 生成产物
  ↓
本地持久化
IndexedDB 业务实体 · chrome.storage.local 设置 · 逻辑备份
```

核心设计不是“把聊天框放进浏览器”，而是把四个边界分开：

1. 浏览器扩展负责采集、交互和来源身份。
2. WorkOS Transport 负责远端会话与流式协议。
3. 本地 Repository 负责长期知识资产。
4. Agent 负责理解、推理、关联和生成结果。

## 4. 仓库结构与职责

```text
web-reading-assistant/
├─ entrypoints/
│  ├─ background.ts          Chrome 后台协调和消息路由
│  ├─ content.ts             网页注入、划词、框选和页面抽取入口
│  └─ sidepanel.html         Side Panel HTML 入口
├─ src/
│  ├─ content/               页面变化、正文抽取、来源清单、智能框选
│  ├─ data/                  Dexie、实体 Repository、迁移、备份和 Markdown
│  ├─ search/                本地全文检索与真实命中定位
│  ├─ services/              WorkOS、上下文协议、存储和跨层服务
│  ├─ shared/                扩展消息、页签目标和共享协议类型
│  └─ sidepanel/             React UI、应用协调器和纯交互逻辑
├─ public/                   扩展和产品静态资源
├─ docs/                     当前文档、交付手册和历史归档
├─ CHANGELOG.md              实现版本变化，不单独证明已发布
├─ CONTEXT.md                项目稳定术语
├─ README.md                 用户与开发者快速入口
├─ package.json              依赖、版本和开发命令
└─ wxt.config.ts             WXT 与 Chrome Manifest 配置
```

### 4.1 高价值入口

| 关注点 | 先读文件 |
| --- | --- |
| 扩展上下文通信 | `entrypoints/background.ts`、`entrypoints/content.ts`、`src/shared/extensionMessages.ts` |
| 页面读取 | `src/content/pageExtractor.ts`、`src/content/pageManifest.ts` |
| 产品总协调 | `src/sidepanel/App.tsx` |
| 上下文模型 | `src/sidepanel/types.ts`、`src/sidepanel/contextItems.ts` |
| WorkOS 双通道 | `src/services/workosTransport.ts`、`workosTransportFactory.ts`、`workosClient.ts`、`workosInternalV2.ts` |
| SSE 解析 | `src/services/workosSse.ts` |
| 附件上传 | `src/services/workosFileUpload.ts` |
| Agent 内容 | `src/services/buildAgentContent.ts`、`buildYemaiContext.ts`、`renderYemaiContext.ts` |
| 本地数据 | `src/data/database.ts`、`workspaceRepository.ts`、`src/services/workspaceStorage.ts` |
| 旧数据迁移 | `src/data/legacyWorkspaceMigration.ts`、`src/services/workspaceState.ts` |
| 搜索 | `src/search/workspaceSearch.ts`、`src/sidepanel/searchSession.ts` |
| 阅读卡片 | `src/data/readingCardRepository.ts`、`src/sidepanel/readingCards.ts` |
| 本地备份 | `src/data/localBackup.ts`、`localBackupImport.ts`、`src/services/localBackup.ts` |

`src/sidepanel/App.tsx` 是当前的应用协调器，不是理想化的最终模块边界。它同时承担浏览器协调、Workspace 更新、请求队列、连接、上传、备份、卡片和较多 UI 状态。修改前先找到可以测试的纯逻辑 Seam，不要为“拆文件”一次性重写数据流。

## 5. 核心运行链路

### 5.1 页面读取

```text
当前活动标签页
→ Background 定位 Side Panel 所属窗口中的 tabId
→ Content Script 克隆 document
→ Readability 提取正文
→ Turndown 转 Markdown
→ 失败时退回可见 body 文本
→ 生成有限 Manifest、规范化 URL、来源 ID 和正文哈希
→ 返回 Side Panel
```

重要约束：

- 完整抽取正文最多 40,000 字符。
- 发给 Agent 的 Snapshot 最多 12,000 字符。
- 完整正文只停留在请求准备内存，不写入会话历史。
- 当前没有 X/Twitter 专用抽取器；仍使用通用抽取和降级策略。
- Chrome 内置页、Web Store、部分内置 PDF 页面无法注入。
- 扩展重新加载前已经打开的旧页面，可能需要刷新一次才能获得新版 Content Script。

### 5.2 一轮 Agent 请求

```text
Composer 发送
→ 创建 QueuedAgentRequest
→ 必要时读取当前页面
→ 冻结本轮 ContextItem 快照
→ 根据来源账本决定 manifest / snapshot / reuse
→ buildAgentContent
→ yemai.context.v1 Envelope
→ 必要时创建远端 conversationUuid
→ WorkosTransport.executeStream
→ 正文 / 工具状态 / 表单 / 产物回调
→ 更新内存 Workspace
→ 350ms 合并保存到 IndexedDB
→ 成功后更新来源交付账本
```

页面是否“已经发过”必须限定在同一个远端 `conversationUuid`。切换 Agent、Transport 或重建远端会话后要重新提供必要的页面信息。失败请求不能提前把来源记为已交付。

### 5.3 WorkOS 通道

| 通道 | 凭据 | 优势 | 风险 |
| --- | --- | --- | --- |
| `public-v1` | Agent UUID + `AP_...` Token | 官方、简单、认证边界明确 | 当前多轮流式存在已确认的服务端异常 |
| `internal-v2` | Agent UUID + Access Token + User UUID + Organization UUID | 当前支持可靠多轮真流式与内部上传 | 未公开协议，可能随 WorkOS 网页端变化 |

内部 v2 每轮必须先订阅，再提交，并用 `runId` 过滤事件。v2 失败后**不得自动回退到 v1 重发**：提交可能已经成功，自动重发会让 Agent 或工具执行两次。

详细约束见 [WORKOS_V2_TRANSPORT_MIGRATION.md](./WORKOS_V2_TRANSPORT_MIGRATION.md)。

### 5.4 附件上传

对话 Transport 与文件上传器是两个独立接口：

- `public-v1` 使用公开 multipart 上传，受服务端格式白名单限制。
- `internal-v2` 使用内部网页上传链路：申请临时 OSS 地址，上传原文件，只保存 `readUrl`。
- 签名 `uploadUrl` 不进入历史、日志或错误消息。
- HTML 只在内部上传通道开放，并保持原文件与 `text/html`。
- PPT/PPTX 尚未获得两条通道的真实支持，因此不开放选择。
- 原始 `File` 和本地 `blob:` 预览只在 Side Panel 内存中存在。

### 5.5 SSE 安全投影

`src/services/workosSse.ts` 负责网络 chunk 到产品状态的转换：

- 按 SSE 空行组装事件，而不是把网络 chunk 当作完整事件。
- 解开外层和内层 JSON。
- 按消息和 run 归属累计文本。
- 将工具活动投影成名称、状态和耗时。
- 支持交互表单、图片、文件产物和终态。
- 不把原始推理、工具参数或完整输出交给 UI。

这是高风险协议边界。修改时优先增加录制样本的纯解析测试，再进行真实 WorkOS 验证。

## 6. 本地数据模型

### 6.1 事实源

| 数据 | 事实源 | 是否进入 v0.5 备份 |
| --- | --- | :---: |
| 会话 | IndexedDB `conversations` | 是 |
| 消息 | IndexedDB `messages` | 是 |
| 会话来源 | IndexedDB `conversationSources` | 是 |
| Agent 产物元数据 | IndexedDB `artifacts` | 是 |
| 阅读卡片 | IndexedDB `readingCards` | 是 |
| 数据库迁移元数据 | IndexedDB `meta` | 否 |
| 连接凭据与 Agent 设置 | `chrome.storage.local` | 否 |
| 打开工作页和当前工作页 | `chrome.storage.local` | 否 |
| 待消费引用 | `chrome.storage.session` | 否 |
| 搜索索引 | 打开搜索时的内存派生数据 | 否，可重建 |
| 文件二进制和本地预览 | 临时内存或远端存储 | 否 |

IndexedDB 数据库名为 `yemai-reading-assistant`，当前 Dexie schema 为 v2。React 仍消费会话数组形式的 `WorkspaceState`，Repository 负责在内存投影与实体行之间转换，并只写发生变化的记录。

### 6.2 版本与迁移矩阵

| 层级 | 当前版本 | 负责文件 | 兼容策略 |
| --- | --- | --- | --- |
| Workspace Snapshot | v6 | `src/services/workspaceState.ts` | 显式识别并规范化 v1～v6；未知或损坏版本拒绝 |
| IndexedDB / Dexie | v2 | `src/data/database.ts` | v1 增加 v2 `readingCards`，升级测试必须保留 |
| 旧快照迁移 | 一次性状态机 | `src/data/legacyWorkspaceMigration.ts` | `data-written → complete`，回读数量后完成 |
| 本地备份格式 | `yemai-backup` v1 | `src/data/localBackup.ts` | 未知 `formatVersion` 明确拒绝，没有前向猜测 |
| Agent 上下文 | `yemai.context.v1` | `src/shared/yemaiContext.ts` | 插件构造结构化 Envelope，再投影为 Agent 文本 |

迁移的关键不变量：

- IndexedDB 成功迁移后是历史唯一事实源；旧快照只作恢复材料，不运行时双写。
- 数据库读取失败时不能用空工作区覆盖已有历史。
- 中断流式状态恢复为 `stopped`，不能伪装成完整回答。
- 搜索索引是可丢弃派生数据，不进入迁移和备份。

### 6.3 v0.5 备份语义

`.yemai.json` 是逻辑备份，不是 IndexedDB 文件副本。

```text
旧设备 IndexedDB 五类业务实体
→ 同一只读事务导出
→ 版本化 JSON
→ 新设备校验和预览
→ 单个读写事务导入
→ 回读数量
→ 重建搜索索引
```

合并模式是保守补充，不是双向同步：

- 会话、消息、来源和产物：本机已有相同主键时保留本机。
- 阅读卡片：比较 `updatedAt`，保留更新版本。
- 本机缺少的实体从备份补入。
- 重复导入同一文件应保持幂等。

替换模式会替换五类本地知识资产，但不触碰连接配置和界面偏好。备份不含文件二进制；远端下载链接可能过期或依赖授权。

## 7. 版本演进：v0.1 → v0.6

事实优先级：Git 标签树和当前代码 → 验收与测试证据 → Changelog → 提交标题。提交标题曾出现版本名与实际内容不一致，不能单独作为版本边界。

| 版本 | 核心能力 | 主要代码边界 | 集成与发布状态 |
| --- | --- | --- | --- |
| v0.1.0 | 阅读问答闭环、页面抽取、上下文工作台、会话/分支、流式回答 | 标签 `v0.1.0` → `815ce39` | 已实现，有标签 |
| v0.2.0 | 连接安全、首次配置、用户触发的 WorkOS 凭据导入 | `96a5238`，标签 `v0.2.0` → `561a24d` | 已实现，有标签；README 记录为最新正式安装包 |
| v0.3.0 | IndexedDB 实体化、增量保存、全局搜索、长会话导航、富产物 | `5619903` / `a9606e7`，收口 `631928f` | 已实现并被后续主线吸收；无独立标签 |
| v0.4.0 | 阅读卡片成为独立知识资产，搜索整合和可访问性修复 | `f519f47`，merge `5eba379`；修复 `dc3e837` / `7e194ad` | 已实现、真实回归有记录、已进入 `origin/main`；无标签 |
| v0.4.1 | 搜索会话快照、按需加载、DEV/生产构建区分 | `705f67d`，merge `b137de8` | 已实现、已验收、仅合入本地 `main` |
| v0.5.0 | 本地备份/迁移、Markdown 出口、安全导入 | `52b5d1f`，merge `a2b7d21` | 已实现、自动门禁通过、仅合入本地 `main`；人工清单和正式发布未完成 |
| v0.6.0 | 完整回答与划词片段收藏、卡片河流、收藏范围搜索、认知形成改为收藏优先 | `34e24e8`、`7f64183` 及发布提交，标签 `v0.6.0` | 已实现、自动门禁通过、已合入并正式发布 |

### 7.1 v0.1：先闭合主路径

建立了 Chrome Side Panel、网页读取、普通划词、智能框选、页面/引用/文件/图片上下文、WorkOS 双 Transport、流式回答、队列、会话恢复和分支。这个版本证明了产品主链：**从网页资料进入一次可追溯的 Agent 对话**。

主要优化包括：页面同版本避免重复投递、请求时冻结上下文、工具安全投影、Mermaid/产物展示和输入框运行状态。局限也在此阶段形成：X 无专用抽取、内部协议易变、主分包较大、没有远端历史。

### 7.2 v0.2：把连接从“能用”变成“可交付”

移除默认 Agent UUID，连接配置升级时清除旧隐式值；新安装默认选择实验性实时通道，但保留已有用户的明确选择。凭据导入限定在用户主动触发、固定 WorkOS 域名和三个固定键，只填入设置草稿，不自动保存或发送。

可复用判断：任何便捷的“自动配置”都必须先定义来源、字段、触发、保存和失败五个边界。

### 7.3 v0.3：从聊天侧栏变成本地工作区

将整份 `workspaceState` 的反复重写迁移为 IndexedDB 实体表和增量保存；旧快照通过可恢复的一次性状态机迁移。随后加入全文搜索、命令面板、归档恢复、精确消息定位、Preview Rail、Mermaid 和 Agent 产物。

搜索问题的关键优化不是继续增加模糊度，而是让**召回、摘要和正文定位使用同一套真实匹配规则**。中文使用词级分段；日期、URL、文件名和带连接符标识符必须在同一字段完整命中。

### 7.4 v0.4 / v0.4.1：把回答沉淀为独立资产

收藏卡片不只是消息上的书签状态，而是有稳定 ID、类型、正文快照和有限来源的独立实体。完整回答可以包含产物元数据；划选片段按来源消息和正文指纹去重。删除会话不级联删除卡片；原会话存在时可以精确回跳，不存在时卡片仍可阅读。

v0.4.1 把搜索改成显式会话快照：打开时冻结，关闭后再刷新，避免流式 token 持续重建索引。搜索、MiniSearch 和卡片面板改为按需加载，并让开发构建显式带 `DEV`，减少误加载两个扩展 ID 的风险。

Changelog 将 v0.4 标记为 2026-08-21，代码功能与合并发生在 2026-08-23。本文以提交边界为工程事实，保留 Changelog 日期作为版本记录标签。

### 7.5 v0.5：让本地知识可迁移、可退出

新增版本化逻辑备份、导入预览、幂等合并、事务替换和阅读卡片 Markdown 出口。安全性来自读取 Seam 的隔离：备份模块根本不读取 Token 与本机设置，而不是导出后再搜索敏感字符串。

真实数据暴露了两个重要边缘模型：

- 正文为空但包含文件/图片产物，是合法回答。
- URL 为空但字段存在，是尚未绑定网页的合法占位来源。

校验必须区分“字段缺失、类型错误”和“允许为空”，并用真实历史样本建立回归测试。

历史验收快照见 [archive/releases](./archive/releases/)。

## 8. 安全与信任边界

以下约束优先级高于局部交互便利：

- 网页、引用、附件和 Agent 输出都按不可信数据处理。
- `yemai.context.v1` 始终标记页面不可信，Agent 固定指令承担另一层提示注入防护。
- 连接凭据只在可信扩展上下文使用，不进入消息、备份、搜索、日志和错误回显。
- 从 WorkOS 获取凭据必须由用户主动触发，只读固定域名和固定键。
- Agent Markdown 不启用原始 HTML。
- SSE 只向 UI 输出安全投影。
- 不对可能已经提交成功的请求自动换通道重发。
- 本地删除不得声称删除 WorkOS 远端数据。
- 备份替换必须先预览、二次确认，并在单个事务中完成。

## 9. 开发、运行与验证

### 9.1 环境

- Node.js LTS
- npm
- Chrome 116+
- 用户自己的 WorkOS Agent UUID 与对应通道凭据

仓库目前没有 `engines` 字段和 CI。接手前先运行 `node --version`、`npm --version`，并记录能稳定通过的版本；不要把某个 Agent 沙箱中损坏的全局 npm 包装器误判为项目失败。

### 9.2 标准命令

```bash
npm install
npm run check
npm test
npm run build
npm run zip
```

| 命令 | 目的 |
| --- | --- |
| `npm run dev` | WXT 开发构建，产物名带 `DEV` |
| `npm run check` | TypeScript 类型检查 |
| `npm test` | Vitest 全量测试 |
| `npm run build` | 生成 `.output/chrome-mv3` 生产扩展 |
| `npm run zip` | 生成可分发 ZIP |
| `npm run build:diagnostic` | 独立生命周期诊断构建，见 [操作说明](./LIFECYCLE_DIAGNOSTICS.md) |

### 9.3 自动化不能替代的检查

- 扩展重新加载、Manifest 和 Side Panel 打开。
- 旧页面 Content Script 注入与刷新行为。
- 普通划词、智能框选和 Side Panel 隐藏/恢复。
- 真实 WorkOS 多轮流式、停止和附件上传。
- 浏览器重启后的会话/草稿恢复。
- 同扩展 ID 的旧数据迁移。
- 两个扩展 ID 之间的 v0.5 备份迁移。
- 300～400px 窄侧栏、键盘焦点和 reduced motion。

完整门禁见 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)。

## 10. 已知风险与维护热点

### 10.1 外部风险

- Internal v2 和内部上传接口没有兼容承诺。
- 官方 v1 多轮流式异常来自服务端，不能只在前端掩盖。
- 远端产物链接可能过期或依赖授权。
- Chrome 页面权限和扩展更新会影响 Content Script 可用性。

### 10.2 产品缺口

- X/Twitter 专用抽取。
- 批量链接读取及其状态模型。
- WorkOS 远端历史/跨设备同步。
- 关闭 Side Panel 后恢复流式执行。
- PPT/PPTX 上传支持。
- `memory`、`link` 的真实来源协议。
- 首屏主分包仍超过 500 kB。

### 10.3 代码热点

当前快照中以下文件体量较大：`App.tsx`、`styles.css`、`MessageList.tsx`、`Overlays.tsx`、`workosSse.ts`、`workspaceState.ts`。它们不是“立刻重构”的任务清单，而是改动时需要提高验证强度的区域。

推荐的拆分顺序：

1. 先识别稳定领域接口和纯函数。
2. 用现有测试锁住输入输出与故障语义。
3. 把协议、数据事务和 UI 协调分开。
4. 最后再移动组件和样式；不要从视觉文件切割反推数据模型。

## 11. 新 Agent 接手协议

### 11.1 阅读顺序

1. 本文。
2. 根目录 [CONTEXT.md](../CONTEXT.md)。
3. 与任务直接相关的现行专项文档。
4. 相关实现与测试。
5. 只有需要理解历史取舍时才进入 [archive](./archive/README.md)。

### 11.2 修改前

- 检查 Git 分支、工作区和本地/远端差异。
- 用代码和测试验证文档陈述，不复制历史时态。
- 明确改变的是产品能力、协议、持久化格式还是纯 UI。
- 对数据和协议改动写出兼容、失败、重试和回滚语义。
- 先确定最小可验证切片，不把版本收尾变成无边界重构。

### 11.3 修改后

- 运行与风险相称的单元测试、类型检查和构建。
- 对 Chrome 生命周期和真实 WorkOS 能力列出人工门禁。
- 更新当前文档和 Changelog，但不要预先声称已发布。
- 提交、合并、推送、标签和 Release 分别记录，不能用一个“完成”覆盖。
- 新的阶段性计划完成使命后归档，不继续留在当前入口。

## 12. 推荐的下一步

当前开发分支已按用户确认的[收藏问答工作流](./COLLECTION_QA_WORKFLOW.md)实现列表多选、带资料的新会话草稿、用户提问后发送和逐张新建 Obsidian Markdown。先在真实 Chrome 中验证目录授权、同标题文件处理、草稿重载、断线后选择保留和首次 WorkOS 提问，再决定发布。旧认知功能入口与专门文档已移除；历史消息和旧 Markdown 保留。

## 13. 文档地图

### 当前入口

- 本文：当前架构、状态和接手顺序。
- [REUSABLE_PROJECT_SOP.md](./REUSABLE_PROJECT_SOP.md)：可迁移到相似项目的开发方法。
- [CONTEXT.md](../CONTEXT.md)：稳定术语。
- [README.md](../README.md)：用户安装和开发快速入口。
- [CHANGELOG.md](../CHANGELOG.md)：版本实现内容。
- [COLLECTION_QA_WORKFLOW.md](./COLLECTION_QA_WORKFLOW.md)：当前收藏问答、带资料提问和 Obsidian 保存流程。

### 现行专项约束

- [PRODUCT_SPEC.md](./PRODUCT_SPEC.md)
- [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md)
- [context-workbench-architecture.md](./context-workbench-architecture.md)
- [INDEXEDDB_MIGRATION.md](./INDEXEDDB_MIGRATION.md)
- [WORKOS_V2_TRANSPORT_MIGRATION.md](./WORKOS_V2_TRANSPORT_MIGRATION.md)
- [WORKOS_AGENT_PROMPT.md](./WORKOS_AGENT_PROMPT.md)
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)

### 历史证据

- [archive/README.md](./archive/README.md)：归档地图、原路径和使用规则。
