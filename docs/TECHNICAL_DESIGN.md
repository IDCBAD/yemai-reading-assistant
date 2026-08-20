# Chrome 侧边栏 AI 阅读助手：技术架构设计

## 1. 技术目标

- 使用 Manifest V3 构建 Chrome Side Panel 扩展。
- 用最少权限完成划词、正文提取、跨页面会话和 WorkOS API 调用。
- 将 Token 的自动导入限制为用户主动触发、固定 WorkOS 来源和三个固定键；日常网页内容脚本不读取凭据。
- 对页面内容和 Agent 输出建立不可信数据边界。
- 将 WorkOS API、存储和 UI 解耦，以便先使用模拟实现，再替换为真实服务。

## 2. 技术栈

- WXT：扩展入口、Manifest 和构建管理
- React + TypeScript：Side Panel UI 与状态
- 原生 CSS：视觉 token、布局、响应式和动效
- `@mozilla/readability`：普通文章正文抽取
- `turndown`：语义 HTML 转 Markdown
- `react-markdown` + `remark-gfm`：Agent 输出渲染
- Dexie：IndexedDB 实体表、事务与增量持久化
- MiniSearch：本地全文检索、字段权重和英文前缀/模糊匹配
- Vitest：纯逻辑单元测试

第一版不引入大型状态库和动效库。状态使用 React Reducer 与显式 Repository；动效以 CSS transition 为主。

## 3. 扩展入口

```text
entrypoints/
├── background.ts
├── content.ts
└── sidepanel/
    ├── index.html
    ├── main.tsx
    └── App.tsx
```

建议最低 Chrome 版本为 116，以使用 `chrome.sidePanel.open()` 响应内容脚本中的用户点击。

## 4. 组件职责

### 4.1 Content Script

负责：

- 监听当前页面文本选区
- 渲染和定位划词悬浮入口
- 在 Side Panel 已打开时上报新选区
- 提取页面正文和页面元数据
- 处理普通文章与 X 的抽取策略
- 仅在 `https://aipower.yingdao.com` 且收到明确导入请求时读取 `accessToken`、`uuid` 和 `organizationUuid` 三个固定键

不得负责：

- 在普通网页或非用户触发的流程中读取 Token
- 调用 WorkOS API
- 访问完整会话历史
- 决定任意跨域请求地址

### 4.2 Service Worker

负责：

- 配置工具栏图标打开 Side Panel
- 处理悬浮入口点击并调用 `chrome.sidePanel.open()`
- 维护 Side Panel 的长连接状态
- 在 Content Script 和 Side Panel 之间路由消息
- 查找已打开的 WorkOS 页面并路由一次性凭据导入请求
- 使用 `chrome.storage.session` 暂存待处理引用
- 初始化可信存储访问级别

Service Worker 不承担 SSE 主连接，避免其生命周期影响长响应。

### 4.3 Side Panel

负责：

- 会话、消息、引用、附件和页面状态
- 请求当前标签页提取正文
- 构造 WorkOS `content` 与 `attachments`
- 创建和复用远端会话
- 文件上传
- SSE 解析与正文增量渲染
- 本地历史持久化

Side Panel 初始化时通过 `chrome.windows.getCurrent()` 记录所属窗口，并只处理该窗口的 `tabs.onActivated` 事件。页面抽取和智能框选始终使用该窗口内已记录的活动 `tabId`，不使用其他 Chrome 窗口的最近焦点页面。多个窗口分别打开 Side Panel 时，各实例独立跟随各自窗口。

## 5. 消息协议

跨上下文消息使用可辨识联合类型，禁止传递任意命令字符串。

```ts
type ExtensionMessage =
  | { type: 'selection:candidate'; payload: SelectionQuote }
  | { type: 'selection:commit'; payload: SelectionQuote }
  | { type: 'page:extract'; payload: { tabId: number } }
  | { type: 'page:snapshot'; payload: PageSnapshot }
  | { type: 'panel:ready' }
  | { type: 'panel:closed' };
```

所有来自 Content Script 的 payload 必须做长度、类型和 URL 校验。

## 6. 核心数据模型

```ts
interface LocalConversation {
  id: string;
  remoteUuid?: string;
  remoteTransport?: 'public-v1' | 'internal-v2';
  remoteAgentUuid?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  branch?: ConversationBranch;
  messages: ChatMessage[];
  draft: ConversationDraft;
  pages: Record<string, ConversationPage>;
}

interface OpenConversationTab {
  id: string;
  conversationId: string;
  openedAt: number;
}

interface WorkspaceState {
  activeOpenTabId: string;
  openTabs: OpenConversationTab[];
  conversations: Record<string, LocalConversation>;
}

interface ConversationDraft {
  input: string;
  quotes: SelectionQuote[];
  attachments: DraftAttachment[];
}

interface ConversationBranch {
  rootConversationId: string;
  parentConversationId: string;
  sourceMessageId: string;
  ordinal: number;
}

interface ConversationPage {
  pageId: string;
  url: string;
  title: string;
  contentHash: string;
  sentAt: number;
  version: number;
}

interface PageSnapshot {
  pageId: string;
  url: string;
  title: string;
  siteName?: string;
  markdown: string;
  contentHash: string;
  extractedAt: number;
  extractor: 'readability' | 'x-adapter' | 'fallback';
  quality: 'high' | 'partial' | 'fallback';
}

interface SelectionQuote {
  id: string;
  text: string;
  pageId: string;
  pageTitle: string;
  pageUrl: string;
  createdAt: number;
}
```

消息、附件与运行状态使用稳定 ID，避免 SSE 增量更新依赖数组下标。

`remoteUuid`、消息、草稿和页面来源全部属于会话。插件 Tab 只保存 `conversationId`，是会话的打开窗口，不承载独立 Agent 记忆。一个会话最多在一个插件 Tab 中打开；从历史选择已打开会话时直接激活对应 Tab。

同一工作页在浏览器页面变化后继续指向同一会话，新页面进入该会话的 `pages` 来源集合。“新对话”同时创建新的本地草稿会话和工作页，因此不同会话的请求不会共享 `conversationUuid`，也不会产生不可见的跨工作页记忆污染。

会话分支会创建新的 `LocalConversation`，复制当前会话在分支点之前的可见消息，并保存一次性的 `pendingBranchContext`。分支不复制原 `remoteUuid`。下一次发送时先懒创建新的远端会话，再把 `pendingBranchContext` 与新问题合并到首轮请求中；服务端开始返回文本或工具事件后即清除这份一次性上下文，避免后续请求重复注入。

基础标题和分支关系分开存储。`title` 不追加重复的“· 分支”；历史和顶栏根据 `ConversationBranch.ordinal` 渲染分支徽标或副标题。

历史视图根据 `parentConversationId` 生成展示用会话树；缺失父节点或异常循环会被提升为根节点，避免陈旧本地元数据使会话不可访问。分支工作页通过 `sourceMessageId` 定位父会话中的分支点，并提供返回父会话的轻量入口。

### 6.1 Tab 操作约束

- `openTabs.length` 硬上限为 10。
- 达到上限时 `+` 为 disabled，不能只在事件处理器里静默拒绝。
- Tab 条横向滚动，激活、新建或历史定位后调用 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`。
- `+` 是唯一的“新对话”入口，同时创建 `OpenConversationTab + LocalConversation`。
- 新建会话、创建分支和打开历史会话都不得替换当前 `OpenConversationTab.conversationId`。
- 历史选择未打开会话时创建新的 `OpenConversationTab`；已打开会话则只激活对应工作页。
- 达到上限后不创建后台会话，也不把新会话悄悄塞入当前工作页。
- 最后一个工作页不可关闭，关闭动作不得隐式创建空白会话。
- 关闭 Tab 只移除 `OpenConversationTab`，不删除 `LocalConversation`。
- 分支在未达上限时新建 Tab；达到上限时复用当前 Tab 打开新分支。

### 6.2 流式回答滚动状态

消息区使用“粘底 / 已脱离”两态模型。用户位于底部时，每个流式增量直接更新 `scrollTop`，避免为高频 token 累积平滑滚动；用户通过鼠标滚轮或触摸手势向上阅读后，立即退出粘底，后续增量不得修改阅读位置。距离底部超过阈值时显示独立于滚动内容的悬浮返回按钮；点击后按系统减弱动态偏好选择平滑或即时回到底部，并重新进入粘底状态。切换本地会话或显式发送新问题时重置为粘底。

## 7. 本地存储

### IndexedDB

保存：

- 会话索引与消息
- 页面元数据和哈希
- 会话草稿与结构化分支元数据
- Agent 输出产物元数据

历史按 `conversations`、`messages`、`conversationSources` 和 `artifacts` 拆表。Repository 继续向 React 层提供 `WorkspaceState` 投影，并通过实体签名只写入发生变化的记录；流式消息更新不再重写完整历史。

### `chrome.storage.local`

保存 Token、用户设置、打开工作页与当前工作页等小型配置。历史迁移完成后，旧 `workspaceState` 暂时保留为恢复材料，但不再运行时双写。

不保存已发送页面的完整正文，也不申请 `unlimitedStorage`。设置页分别估算 IndexedDB 历史体积、读取扩展配置占用，并使用 `navigator.storage.estimate()` 展示浏览器估算配额；该配额不是固定的 10 MiB 精确上限。

`archivedAt` 仅表示本地历史分类。归档和恢复不会调用 WorkOS API；工作区恢复时若发现归档会话仍被某个 `OpenConversationTab` 引用，会自动取消归档以维持状态不变量。

永久删除只接受带 `archivedAt` 且未被工作页引用的会话。单条删除不级联删除分支；批量清空也保留任何异常情况下仍被工作页引用的记录。释放附件预览和上传状态前需要排除仍被保留会话共享的附件 ID 与 `blob:` URL。所有永久删除都只更新本地工作区，不调用远端会话或文件删除接口。

旧本地工作区使用带版本号的 `workspaceState` 快照。首次打开 v0.3a 时先使用已有 v1～v6 normalizer 校验和升级，再通过一次性事务迁入 IndexedDB。数据库回读校验成功后才写工作页状态；损坏、未知版本或回读失败的数据不会直接进入 UI。

流式文本会频繁更新。Side Panel 继续使用 350ms 尾随保存，并在 `visibilitychange: hidden`、`pagehide` 和组件卸载时补写最新内存状态；保存队列会合并等待期间的更新，Repository 只写变化的消息实体。恢复时，所有遗留的 `streaming / running / pending` 状态统一收口为 `stopped`，因为已经断开的 SSE 无法可靠续接。

启动时必须执行：

```ts
await chrome.storage.local.setAccessLevel({
  accessLevel: 'TRUSTED_CONTEXTS',
});
```

### `chrome.storage.session`

保存：

- Side Panel 关闭期间待消费的引用队列
- 当前窗口的临时协调状态

浏览器重启后可以丢弃这些数据。

## 8. WorkOS 传输层

安装包不提供默认 Agent UUID。当前 Agent UUID 保存在 `workosConnectionSettings.agentUuid`，由用户显式配置，供 v1/v2 Transport 共用，并在创建远程 Conversation 时传入。连接配置升级到 v2 时会清空旧版本可能隐式保存的 Agent UUID，避免不同用户误用同一个 Agent。

上层对话逻辑只依赖统一的 `WorkosTransport`：

```ts
interface WorkosTransport {
  kind: 'public-v1' | 'internal-v2'
  createConversation(signal?): Promise<string>
  executeStream(conversationUuid, request, callbacks, signal?): Promise<void>
}
```

当前实现保留两条可切换通道：

- `PublicV1Transport`：官方公开 v1 API，认证只需要 `AP_...` Token。
- `InternalV2Transport`：WorkOS 网页端 v2 协议，先订阅 SSE、再提交消息，并以 `runId` 关联本轮事件。

附件上传暂时不属于统一执行传输：它仍调用 v1 公开上传接口，并要求单独配置 v1 API Token。迁移原因、风险和删除条件见 [WorkOS v2 可切换传输通道迁移方案](./WORKOS_V2_TRANSPORT_MIGRATION.md)。

输入框的粘贴图片与附件按钮复用同一条上传管道：`Composer` 只负责从 `ClipboardEvent.clipboardData` 中提取图片、生成可读文件名并交给上层；`App` 统一完成数量和大小校验、v1 文件上传、草稿状态更新以及发送时的 URL/MIME 组装。没有图片的粘贴事件不会被拦截，因此文本输入仍保持原生行为。

图片上传期间使用 `URL.createObjectURL(file)` 提供即时预览；远端 `fileReadUrl` 确认可显示后切换为远端地址并调用 `URL.revokeObjectURL()`。本地 `blob:` 地址被明确排除在工作区快照之外，删除附件、清空历史和 Side Panel 卸载时也会释放，避免把图片数据写入 `chrome.storage.local` 或长期占用内存。已发送图片渲染为行内附件 Token；完整图片只在 Token 悬浮、聚焦或点击时挂载，悬浮预览根据视口空间自动选择向上或向下展开，并在滚动、缩放或移出安全区域时关闭。远端图片不可显示时降级为普通文件 Chip。

附件上传与对话传输分别由 `WorkosFileUploader` 和 `WorkosTransport` 承担。公开 v1 连接使用 multipart 文件接口；内部 v2 连接使用网页端临时地址协议：先向 WorkOS 申请 `uploadUrl` 与 `readUrl`，再以文件原始 MIME 对 `uploadUrl` 执行 OSS PUT，发送时只使用 `readUrl`。签名 URL 不进入本地会话存储。两条上传通道拥有各自的格式白名单，文件类型图标只负责识别，不代表当前通道必然允许上传。

当前代码位置：

```text
src/services/workosConnection.ts
src/services/workosTransport.ts
src/services/workosTransportFactory.ts
src/services/workosClient.ts
src/services/workosInternalV2.ts
src/services/workosSse.ts
src/services/buildAgentContent.ts
```

SSE 由 Side Panel 直接持有，停止生成使用 `AbortController`。这避免了 MV3 Service Worker 休眠导致长连接中断。连接凭证不传入 Content Script，也不会写入日志、会话或错误文本。

### 8.1 v1 创建会话

```text
POST /oapi/agent/v1/agents/{agentId}/conversations
```

读取 `data.conversationUuid`。

### 8.2 上传文件

```text
POST /oapi/power/v1/file/upload
Content-Type: multipart/form-data
```

读取 `data.fileReadUrl`，发送时转换为：

```json
{
  "url": "<fileReadUrl>",
  "filename": "example.pdf"
}
```

### 8.3 v1 SSE 执行

```text
POST /oapi/agent/v1/conversations/{conversationUuid}/execute/stream
Content-Type: application/json; charset=utf-8
```

不能使用 `EventSource`，需要用 `fetch()` 和 `response.body.getReader()` 处理 POST 流。

SSE `data` 中还包含序列化后的第二层 JSON。解析器需要：

1. 按 SSE 空行拆分事件，而不是假定每个网络 chunk 是完整事件。
2. 解析外层 `data` JSON。
3. 对外层对象中的 `data` 字符串再次执行 `JSON.parse()`。
4. 建立 `partID → part type` 映射。
5. 只累计 `type: text` 的 `message.part.delta`。
6. 使用完整的 `message.part.updated` 文本校正最终消息。
7. 识别 `run.terminal` 的成功或失败状态。
8. 识别 `xybot-stream-complete` 后关闭本地运行状态。
9. 将工具 part 或工具生命周期事件投影为稳定的工具 ID、名称、状态和起止时间。
10. 将 `file / image / artifact / attachment` part 投影为只包含 ID、HTTPS 地址、文件名、MIME、尺寸和缩略图的输出产物；未知对象和原始工具输出仍不得进入 UI。

### 8.4 v2 顺序流执行

v2 将消息提交和流式订阅拆开。每轮必须：

1. `GET /api/agent/v2/conversations/{conversationUuid}/events/messages/subscribe` 建立 SSE；
2. `POST /api/agent/v2/conversations/{conversationUuid}/queue/submit` 提交本轮消息；
3. 从提交响应递归读取 `runId`；
4. 忽略明确携带其他 `runId` 的历史事件；
5. 只由当前 `runId` 的完成事件结束本轮。

部分正文事件可能不携带 `runId`，因此解析器不能把“缺少 runId”和“runId 明确不匹配”视为同一种情况。订阅与提交共享同一个 `AbortController`；失败后不得自动切换 v1 重发，以免 Agent 或工具重复执行。

内部 reasoning、Agent 配置和部署事件不得写入用户消息。工具事件只能进入安全投影；工具参数、完整输出、调试元数据和原始事件均不得进入 React 消息状态。侧边栏以可折叠的“运行过程”展示工具名称、运行状态和可计算的耗时，不展示模型原始思维链。

Agent 输出产物使用独立的 `AssistantArtifact`，不复用代表用户输入的 `DraftAttachment`。同一产物的流式更新按稳定 ID 或远程 URL 合并；一轮只要收到正文或至少一个产物即可完成。工作区快照只持久化产物元数据与 HTTPS 地址，不缓存图片或文件二进制。恢复时再次校验 URL 协议，避免被篡改的本地快照生成可执行链接。

生成图片在消息内按需加载，并复用 Side Panel 灯箱交互；加载失败时降级为普通文件卡片。HTML、Markdown、PDF、Office 等文件默认只显示下载卡片，不把不可信 HTML 嵌入回答。浏览器无法遵守跨域 `download` 时，链接退化为由浏览器打开远程文件；MVP 不新增 `downloads` 权限。

Markdown fenced code block 的语言为 `mermaid` 时，流式阶段保持源码，回答完成后动态导入 Mermaid。渲染器使用 `securityLevel: strict`、`htmlLabels: false`、文本/边数量上限和不可被回答覆盖的 secure 配置；生成 SVG 还会移除脚本、事件属性、外部链接与外部 CSS URL。解析失败时保留原始源码。Mermaid 独立分包，普通回答不会加载图表运行时。

`run.terminal` 的正常终态需要兼容 `success / succeeded / completed / finished / done / ok` 等常见表达。存在正文但终态异常时仍保留正文，并降级显示为部分失败提示；不得用高强调错误卡遮断已经可读的回答。

### 8.5 会话分支与通道切换上下文

WorkOS 当前接口没有“克隆会话”能力。插件将分支点之前的可见记录序列化为 JSON，并用 `<conversation_branch_context>` 包裹后放入新会话的第一条请求。序列化范围包括：

- 用户问题
- 用户引用的文本、标题和 URL
- Agent 返回的原始 Markdown

序列化范围明确排除工具活动、错误调试信息、内部 reasoning 和工具输入输出。分支创建本身不调用 API；用户真正继续提问时才创建远端会话。

分支本地记录额外保存 `rootConversationId / parentConversationId / sourceMessageId / ordinal`，用于历史定位和展示；这些字段不作为对话正文发送给 Agent。

远程 Conversation 还保存创建它的 `remoteTransport` 与 `remoteAgentUuid`。用户切换通道或 Agent UUID 后不会复用旧目标的 `remoteUuid`；下一轮在新目标创建远程会话，并通过 `<conversation_transport_handoff_context>` 一次性发送最近 6 条有效消息。交接内容只保留最近活动页面的来源身份，不复制页面 Manifest，且整体不超过 12,000 字符；旧版本中缺少 `remoteAgentUuid` 的远程会话视为目标不明，下一轮会安全地重建远程会话。

当前页卡片的可见性与本轮页面投递深度是两个独立状态。包含网页选区或回答引用时，本轮只发送精确引用，不因卡片仍在输入区而隐式附加整页 Manifest；页面总览或没有精确引用的页面任务才按来源账本决定 `manifest`、`snapshot` 或 `reuse`。因此保留引用卡片不会持续放大多轮请求。

## 9. 页面抽取

### 普通网页

1. 克隆当前 `document`，避免 Readability 修改真实 DOM。
2. 使用 Readability 提取文章主体。
3. 使用 Turndown 转成 Markdown。
4. 清理脚本、样式、导航和重复空白。
5. 保留标题、列表、引用和代码块。
6. 生成 Page Manifest，包括有限概览、H1-H3 结构和相关入口。
7. 对规范化 URL 生成稳定来源 ID，对完整清洗正文生成内容版本哈希。

### X / Twitter

优先提取当前详情页中可识别的 `article`，并保留作者、正文和页面 URL。无法可靠识别线程时返回 partial 状态，不读取整个时间线。

### 降级

Readability 失败时仅提取可见主文本，并在 UI 标记为“基础读取”。不得默默将导航和整页噪声伪装为高质量正文。

## 10. 上下文组装

插件内部使用 `yemai.context.v1` JSON Envelope，WorkOS 适配器再把它渲染成有明确标题和普通文本 URL 的 Markdown。用户问题始终是一级字段，不再埋在完整页面正文之后。

内部 Envelope 保留 `source_id`、`revision_id`、页面类型、访问提示和交付模式，供插件决定如何组装上下文；发给 WorkOS Agent 的文本投影只包含本轮回答所需的动态信息，例如标题、URL、引用状态和实际资料。协议的信任边界、网页读取条件、引用原则和回答行为固定配置在 WorkOS Agent 的 Agent.md / System Prompt 中，不在每轮用户消息里重复发送。设置页从 `recommendedAgentTemplate.ts` 读取推荐模板并复制到剪贴板；[WORKOS_AGENT_PROMPT.md](./WORKOS_AGENT_PROMPT.md) 解释模板用途和插件侧配套边界。

当前页交付模式包括：

- `manifest`：首次引用或页面更新时发送有限页面清单。
- `reuse`：相同来源和内容版本在同一 WorkOS 会话中已经成功发送。
- `selection`：发送用户明确选择的文本及其独立来源。
- `snapshot`：Agent 无法访问浏览器页面时发送最多 12,000 字符的正文快照。

交付模式在排队请求真正执行时根据最新会话来源账本决定，避免连续排队的问题重复引入同一页面。只有请求成功完成后才更新 `sentAt`、`deliveredRemoteUuid` 和版本记录；失败请求不会让本地错误地认为 Agent 已获得页面。查找历史交付时以会话页面索引为主，并使用已成功消息中的页面快照作为旧数据兼容回退；同 URL 的重复索引选择最近一次成功交付。

`reuse` 必须限定在同一个远端 `conversationUuid` 中。切换 Agent、连接通道或重新创建远端会话后，即使 URL 与内容哈希未变化，也要重新发送页面清单；这避免把本地“读过”误当成新远端会话“已经知道”。旧快照没有 `deliveredRemoteUuid` 时，仅在当前远端目标未变化的前提下按兼容数据处理，下一次成功交付会补齐作用域。

来源 URL 分为展示定位和文档身份两种语义。`normalizeSourceUrl` 保留普通锚点用于界面与选区定位；`normalizeSourceIdentityUrl` 删除普通标题锚点，用于 `sourceId`、`pageId` 和来源账本匹配。`#/`、`#!/` 被视为 Hash Router 路由而保留。当前页与选区属于同一文档时，文本投影只为选区输出“当前页选区”，不重复当前页 URL。

页面抽取仍将完整 Markdown 硬限制为 40,000 字符，但默认 Manifest 只包含 300 字符说明、12 个标题、800 字符开头和 10 个相关入口。完整 Markdown 只存在于请求准备内存，工作区持久化会显式清除 `markdown`；本地可以保存有限 Manifest、URL、哈希、质量、版本和发送时间。

页面、引用和问题中的协议边界标记会在 Markdown 渲染时中和。该处理不能替代 Agent 端固定配置的提示注入防护，二者需要同时存在。插件仓库中的 Agent 协议文档只有在真正安装到 WorkOS Agent 配置后才会生效，不能作为普通用户消息临时附带。

## 11. Manifest 权限

```text
permissions:
- sidePanel
- storage
- favicon

host_permissions:
- https://aipower.yingdao.com/*
- https://power-api.yingdao.com/*

content_scripts.matches:
- http://*/*
- https://*/*
```

`favicon` 仅用于读取 Chrome 已缓存的网站图标，在当前页来源栏中识别站点；不访问第三方 favicon 服务。除此之外，不申请 cookies、history、downloads、webRequest 或任意 HTTP API 权限。

## 12. 安全边界

- 已保存的 Token 仅存在于可信扩展存储和 Side Panel；导入时由 WorkOS 来源的 Content Script 短暂读取并直接返回，不持久化。
- 凭据导入必须由用户点击触发，只允许精确来源 `https://aipower.yingdao.com`，只读取 `accessToken`、`uuid` 和 `organizationUuid`，不得遍历 localStorage。
- 导入结果只填入设置草稿，不自动测试、保存或发送消息。
- 不在日志、错误消息和遥测中输出 Token。
- API 客户端只允许访问固定影刀端点。
- Agent Markdown 不启用原始 HTML 渲染。
- 网页正文、划词和附件都按不可信资料处理。
- WorkOS Agent 系统指令明确防范提示注入。
- 来自网页的字符串不得作为 DOM HTML 直接插入。
- 清空本地历史、删除单条归档和清空已归档都不得声称删除远端数据。

## 13. 已知限制

- 暂无远端历史查询接口，本地与 WorkOS 后台不会双向同步。
- WorkOS 只有会话概念，没有插件 Tab 概念；插件 Tab 的打开状态只存在于本地。
- 分支只能重放插件中可见的会话记录，无法克隆 WorkOS 远端隐藏状态或完整工具结果。
- 清空本地数据后无法从 WorkOS 恢复插件消息 UI。
- Side Panel 关闭时，正在展示的流式回答可能中断且无法恢复。
- Chrome 受限页面无法注入内容脚本。
- 动态站点正文抽取只能渐进增强，不保证通用完美。

## 14. 旧模型与 IndexedDB 迁移（已实现）

`workspaceState` 当前版本为 v6，加载时继续显式识别并升级 v1～v6，损坏或未知版本不会进入 UI。规范化后的数据再迁入 IndexedDB，不把旧结构强行断言为新类型。完整事务、恢复标记和发布回滚策略见 `docs/INDEXEDDB_MIGRATION.md`。

迁移原则：

1. 一个旧的外层会话迁移为一个新的 `LocalConversation`，保留原 `remoteUuid`、标题和分支信息。
2. 旧会话各 Tab 中已经发送的消息按 `createdAt` 合并为一个时间序列，并保留可识别的页面来源。
3. 旧会话所有页面元数据合并进新的 `pages` 集合。
4. 活跃旧 Tab 的草稿迁入主会话；其他旧 Tab 的未发送草稿不得静默丢弃，应转换为独立本地草稿会话。
5. 迁移后为当前会话建立一个 `OpenConversationTab`；历史中的其他会话保持关闭状态，需要时再加载。
6. 已完成的迁移不会重复导入；单元测试覆盖 UUID、消息顺序、页面来源、活动草稿、非活动草稿、流式中断和重复分支后缀。

React 投影仍使用会话数组以保持已有排序与渲染逻辑简单；底层 IndexedDB 已按实体拆表，`OpenConversationTab.conversationId` 仍是唯一绑定键。后续搜索和分页可以直接增加 Repository 查询，不影响 UI 契约。

## 15. 全局搜索与消息定位（已实现）

IndexedDB 是历史数据的唯一事实源；搜索索引是可丢弃的派生数据。用户打开命令面板时，Side Panel 从当时的 `WorkspaceState` 快照构建 MiniSearch 内存索引，面板关闭后不承担持久化一致性职责。这样可以避免流式回答每个 token 同时触发历史写入和搜索索引写入，也不需要为 v0.3a 已迁移的数据库增加第二轮 schema 迁移。

一个会话生成一条标题文档，每条消息生成一条消息文档。字段权重依次为：会话标题、用户提问、Agent 回答、页面元数据、附件或产物文件名。消息文档只保存安全投影：可见正文、有限来源信息和文件名；内部推理、工具参数、完整工具输出、凭据和文件二进制不进入搜索文档。

中文、日文、韩文及混合文本使用 `Intl.Segmenter` 做词级分段，因此“智能体可靠性”可以命中包含“智能体的可靠性”的正文，同时“达人类型”不会因相邻字符而误命中“人类”。拉丁文字支持前缀查询，只有长度足够的纯字母词才启用低比例模糊匹配；数字不做模糊匹配。日期、URL、文件名和带连接符的标识符属于结构化字面量，必须以完整形式出现在同一个索引字段中，不能从正文、页面和文件名跨字段拼接。查询使用 AND 组合，结果摘要从 MiniSearch 实际命中的字段和词项截取，而不是从任意包含单字的字段猜测。

搜索结果选择链路为：

```text
CommandPalette result
→ 若归档则清除 archivedAt
→ 打开或激活唯一工作页
→ MessageList 按 data-message-id 查找用户/Agent 消息
→ 用 CSS Custom Highlight 标记正文命中词
→ 立即滚动到消息内部首个命中词并显示定位反馈
```

恢复归档与打开工作页由一个纯函数完成。工作页达到上限时，函数返回原工作区，不会出现“已经恢复但没有打开”的半完成状态。命令面板使用 `dialog + listbox/option` 语义，支持 `Ctrl/⌘ + K`、上下方向键、Enter 和 Escape；键盘触发的高频交互不使用进出场动画。
