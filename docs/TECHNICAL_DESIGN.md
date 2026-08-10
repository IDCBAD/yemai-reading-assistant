# Chrome 侧边栏 AI 阅读助手：技术架构设计

## 1. 技术目标

- 使用 Manifest V3 构建 Chrome Side Panel 扩展。
- 用最少权限完成划词、正文提取、跨页面会话和 WorkOS API 调用。
- 将 Token 与网页内容脚本隔离。
- 对页面内容和 Agent 输出建立不可信数据边界。
- 将 WorkOS API、存储和 UI 解耦，以便先使用模拟实现，再替换为真实服务。

## 2. 技术栈

- WXT：扩展入口、Manifest 和构建管理
- React + TypeScript：Side Panel UI 与状态
- 原生 CSS：视觉 token、布局、响应式和动效
- `@mozilla/readability`：普通文章正文抽取
- `turndown`：语义 HTML 转 Markdown
- `react-markdown` + `remark-gfm`：Agent 输出渲染
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

不得负责：

- 读取 Token
- 调用 WorkOS API
- 访问完整会话历史
- 决定任意跨域请求地址

### 4.2 Service Worker

负责：

- 配置工具栏图标打开 Side Panel
- 处理悬浮入口点击并调用 `chrome.sidePanel.open()`
- 维护 Side Panel 的长连接状态
- 在 Content Script 和 Side Panel 之间路由消息
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

同一插件 Tab 在浏览器页面变化后继续指向同一会话，新页面进入该会话的 `pages` 来源集合。创建新的插件 Tab 才会创建新的本地草稿会话，因此不同插件 Tab 的请求不会共享 `conversationUuid`，也不会产生不可见的跨 Tab 记忆污染。

会话分支会创建新的 `LocalConversation`，复制当前会话在分支点之前的可见消息，并保存一次性的 `pendingBranchContext`。分支不复制原 `remoteUuid`。下一次发送时先懒创建新的远端会话，再把 `pendingBranchContext` 与新问题合并到首轮请求中；服务端开始返回文本或工具事件后即清除这份一次性上下文，避免后续请求重复注入。

基础标题和分支关系分开存储。`title` 不追加重复的“· 分支”；历史和顶栏根据 `ConversationBranch.ordinal` 渲染分支徽标或副标题。

### 6.1 Tab 操作约束

- `openTabs.length` 硬上限为 10。
- 达到上限时 `+` 为 disabled，不能只在事件处理器里静默拒绝。
- Tab 条横向滚动，激活、新建或历史定位后调用 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`。
- `+` 创建 `OpenConversationTab + LocalConversation`。
- “新对话”创建新的 `LocalConversation` 并替换当前 `OpenConversationTab.conversationId`；旧会话仍在历史索引中。
- 历史选择未打开会话时替换当前 Tab 的 `conversationId`；已打开会话则只激活对应 Tab。
- 关闭 Tab 只移除 `OpenConversationTab`，不删除 `LocalConversation`。
- 分支在未达上限时新建 Tab；达到上限时复用当前 Tab 打开新分支。

## 7. 本地存储

### `chrome.storage.local`

保存：

- Token
- 当前打开 Tab ID
- 已打开 Tab 与会话 ID 的绑定
- 会话索引与消息
- 页面元数据和哈希
- 用户设置
- 会话草稿与结构化分支元数据

不保存已发送页面的完整正文。第一版不申请 `unlimitedStorage`，并监控本地存储用量。

`archivedAt` 仅表示本地历史分类。归档和恢复不会调用 WorkOS API；工作区恢复时若发现归档会话仍被某个 `OpenConversationTab` 引用，会自动取消归档以维持状态不变量。

本地工作区使用带版本号的 `workspaceState` 快照，包含会话字典、已打开 Tab、消息、草稿、`conversationUuid`、当前 Tab ID、分支元数据和待发送的分支上下文。启动时先校验快照结构，再恢复 React 状态；损坏或未知版本的快照不会直接进入 UI。

流式文本会频繁更新，不能在每个 delta 上写入 Storage。Side Panel 使用 350ms 尾随保存，并在 `visibilitychange: hidden`、`pagehide` 和组件卸载时立即补写最新内存快照。恢复快照时，所有遗留的 `streaming / running / pending` 状态统一收口为 `stopped`，因为已经断开的 SSE 无法可靠续接。

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

## 8. WorkOS API 客户端

Agent ID 固定为：

```text
409b06a1-2e2a-4d8c-af3c-ec831c0c6449
```

客户端提供三个能力：

```ts
createConversation(token): Promise<string>
uploadFile(token, file): Promise<{ fileReadUrl: string }>
executeStream(token, conversationUuid, request, callbacks): Promise<void>
```

当前代码位置：

```text
src/services/tokenStorage.ts
src/services/workosClient.ts
src/services/workosSse.ts
src/services/buildAgentContent.ts
```

SSE 由 Side Panel 直接持有，停止生成使用 `AbortController`。这避免了 MV3 Service Worker 休眠导致长连接中断。Token 不传入 Content Script，也不会写入日志或错误文本。

### 8.1 创建会话

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

### 8.3 SSE 执行

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

内部 reasoning、Agent 配置和部署事件不得写入用户消息。工具事件只能进入安全投影；工具参数、完整输出、调试元数据和原始事件均不得进入 React 消息状态。侧边栏以可折叠的“运行过程”展示工具名称、运行状态和可计算的耗时，不展示模型原始思维链。

`run.terminal` 的正常终态需要兼容 `success / succeeded / completed / finished / done / ok` 等常见表达。存在正文但终态异常时仍保留正文，并降级显示为部分失败提示；不得用高强调错误卡遮断已经可读的回答。

### 8.4 会话分支上下文

WorkOS 当前接口没有“克隆会话”能力。插件将分支点之前的可见记录序列化为 JSON，并用 `<conversation_branch_context>` 包裹后放入新会话的第一条请求。序列化范围包括：

- 用户问题
- 用户引用的文本、标题和 URL
- Agent 返回的原始 Markdown

序列化范围明确排除工具活动、错误调试信息、内部 reasoning 和工具输入输出。分支创建本身不调用 API；用户真正继续提问时才创建远端会话。

分支本地记录额外保存 `rootConversationId / parentConversationId / sourceMessageId / ordinal`，用于历史定位和展示；这些字段不作为对话正文发送给 Agent。

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

插件内部使用 `yuemai.context.v1` JSON Envelope，WorkOS 适配器再把它渲染成有明确标题和普通文本 URL 的 Markdown。用户问题始终是一级字段，不再埋在完整页面正文之后。

当前页交付模式包括：

- `manifest`：首次引用或页面更新时发送有限页面清单。
- `reuse`：相同来源和内容版本在同一 WorkOS 会话中已经成功发送。
- `selection`：发送用户明确选择的文本及其独立来源。
- `snapshot`：Agent 无法访问浏览器页面时发送最多 12,000 字符的正文快照。

交付模式在排队请求真正执行时根据最新会话来源账本决定，避免连续排队的问题重复引入同一页面。只有请求成功完成后才更新 `sentAt` 和版本记录；失败请求不会让本地错误地认为 Agent 已获得页面。

页面抽取仍将完整 Markdown 硬限制为 40,000 字符，但默认 Manifest 只包含 300 字符说明、12 个标题、800 字符开头和 10 个相关入口。完整 Markdown 只存在于请求准备内存，工作区持久化会显式清除 `markdown`；本地可以保存有限 Manifest、URL、哈希、质量、版本和发送时间。

页面、引用和问题中的协议边界标记会在 Markdown 渲染时中和。该处理不能替代 Agent 端的提示注入防护，二者需要同时存在。

## 11. Manifest 权限

```text
permissions:
- sidePanel
- storage

host_permissions:
- https://power-api.yingdao.com/*

content_scripts.matches:
- http://*/*
- https://*/*
```

不申请 cookies、history、downloads、webRequest 或任意 HTTP API 权限。

## 12. 安全边界

- Token 仅存在于可信扩展上下文。
- 不将 Token 传给 Content Script。
- 不在日志、错误消息和遥测中输出 Token。
- API 客户端只允许访问固定影刀端点。
- Agent Markdown 不启用原始 HTML 渲染。
- 网页正文、划词和附件都按不可信资料处理。
- WorkOS Agent 系统指令明确防范提示注入。
- 来自网页的字符串不得作为 DOM HTML 直接插入。
- 清空本地历史不声称删除远端数据。

## 13. 已知限制

- 暂无远端历史查询接口，本地与 WorkOS 后台不会双向同步。
- WorkOS 只有会话概念，没有插件 Tab 概念；插件 Tab 的打开状态只存在于本地。
- 分支只能重放插件中可见的会话记录，无法克隆 WorkOS 远端隐藏状态或完整工具结果。
- 清空本地数据后无法从 WorkOS 恢复插件消息 UI。
- Side Panel 关闭时，正在展示的流式回答可能中断且无法恢复。
- Chrome 受限页面无法注入内容脚本。
- 动态站点正文抽取只能渐进增强，不保证通用完美。

## 14. 旧模型迁移（已实现）

`workspaceState` 已从 v1 升级到 v2。加载时先识别版本：v2 直接校验和恢复，v1 进入显式迁移，损坏或未知版本不会进入 UI。迁移只写入新的 v2 快照，不把旧结构强行断言为新类型。

迁移原则：

1. 一个旧的外层会话迁移为一个新的 `LocalConversation`，保留原 `remoteUuid`、标题和分支信息。
2. 旧会话各 Tab 中已经发送的消息按 `createdAt` 合并为一个时间序列，并保留可识别的页面来源。
3. 旧会话所有页面元数据合并进新的 `pages` 集合。
4. 活跃旧 Tab 的草稿迁入主会话；其他旧 Tab 的未发送草稿不得静默丢弃，应转换为独立本地草稿会话。
5. 迁移后为当前会话建立一个 `OpenConversationTab`；历史中的其他会话保持关闭状态，需要时再加载。
6. v2 再次加载不会重复迁移；单元测试覆盖 UUID、消息顺序、页面来源、活动草稿、非活动草稿、流式中断和重复分支后缀。

当前实现使用会话数组而非字典作为本地历史索引，以保持已有排序与渲染逻辑简单；`OpenConversationTab.conversationId` 仍是唯一绑定键，语义与上述目标模型一致。后续历史规模需要搜索或分页时，可在 Repository 层改为字典加顺序索引，不影响 UI 契约。
