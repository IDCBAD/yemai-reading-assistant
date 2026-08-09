# Web Reading Assistant

一个面向个人使用的 Chrome 侧边栏 AI 阅读助手。插件通过影刀 WorkOS Agent API 提供连续对话、当前网页上下文、划词引用和文件问答能力。

当前阶段：**真实网页阅读闭环已接入**。插件可以读取当前普通网页、接收真实划词引用，在会话第一次针对页面提问时注入正文，并按独立 Tab 调用 WorkOS Agent 流式回答。

目前仍未接入文件上传和 X / Twitter 专用抽取器；普通网页使用 Readability，失败时降级为可见正文。

## 已确认的产品原则

- 会话按“阅读任务或学习主题”组织，而不是按网页组织。
- 跨页面默认延续当前会话，用户主动点击“新对话”才切换。
- 一个插件 Tab 对应一个独立会话和一个 `conversationUuid`；不同 Tab 不共享 Agent 记忆。
- 页面只是会话的上下文来源，浏览器页面变化不会自动创建插件 Tab。
- 最多同时打开 10 个会话 Tab；历史会话加载到当前 Tab，已打开会话则直接定位。
- 分支创建新的独立会话，基础标题与分支序号分开保存，避免名称无限追加。
- 页面是带来源标识的上下文；每个页面在同一会话中只发送一次正文。
- 划词内容以独立引用保留，不因加入引用而自动调用 Agent。
- WorkOS Token 由用户在插件中填写，仅保存在扩展可信上下文。
- 本地历史可清空，但 MVP 不删除或同步 WorkOS 远端会话。

## 文档

- [产品需求与 MVP 范围](docs/PRODUCT_SPEC.md)
- [技术架构设计](docs/TECHNICAL_DESIGN.md)
- [实施与验收计划](docs/IMPLEMENTATION_PLAN.md)
- [WorkOS Agent 安全指令建议](docs/WORKOS_AGENT_PROMPT.md)

## 计划中的技术栈

- Chrome Extension Manifest V3
- WXT
- React
- TypeScript
- `@mozilla/readability`
- `turndown`
- `react-markdown` 与 `remark-gfm`
- Vitest

## 本地运行

```bash
npm install
npm run check
npm test
npm run build
```

然后在 Chrome 的“管理扩展程序”中开启开发者模式，选择“加载已解压的扩展程序”，加载：

```text
.output/chrome-mv3
```

首次打开侧边栏会自动进入设置。填写以 `AP_` 开头的 WorkOS Token 后，第一条消息才会创建远端会话。

## 当前已实现

- Token 仅保存到 `chrome.storage.local` 的可信扩展上下文
- 固定 Agent ID 的会话懒创建
- 一个插件 Tab 对应一条独立会话和唯一 `conversationUuid`
- 新增 Tab、当前 Tab 新建对话、历史加载与右键关闭窗口
- 10 个 Tab 硬上限、横向滚动与激活 Tab 自动可见
- 历史中的已打开会话直接定位，未打开会话加载到当前 Tab
- UTF-8 POST SSE
- 双层 JSON、网络 chunk 边界与 text part 解析
- reasoning 与配置事件过滤
- 工具生命周期的安全投影与可折叠运行面板（仅名称、状态、耗时）
- 回答 Markdown 一键复制
- 从任意已完成回答创建带完整可见上下文的独立会话分支
- 结构化分支父子关系、稳定基础标题与分支序号
- 停止生成、错误归一化、克制的部分失败提示和失败重试
- 问题与独立引用发送
- 会话、打开的 Tab、消息、草稿、远端 UUID 与当前 Tab 的本地持久化恢复
- 旧版多 Tab 共享会话快照自动迁移到 v2，保留 UUID、消息、页面来源和未发送草稿
- 普通网页元数据、Readability 正文提取、Markdown 转换和 SHA-256 内容哈希
- 侧边栏关闭时显示轻量划词入口，打开时自动把选区加入当前会话
- 同一页面在同一会话中默认只注入一次正文，正文最长 40,000 字符且不写入本地历史
- 划词入口开关持久化
- 本地历史会话归档与恢复；已打开会话需先关闭 Tab 才能归档

## 当前未实现

- 文件上传
- X / Twitter 详情页和线程专用抽取策略
- 页面正文变化的后台自动哈希比较（当前通过“重新读取”显式更新）
- WorkOS 远端历史同步
- 原始思维链、工具参数与完整工具输出（产品安全边界，非待办功能）

## 开发阶段

1. 已完成可交互 Side Panel 原型。
2. 已完成 WorkOS 会话与 SSE 最小真实链路。
3. 已完成会话、Tab、历史、分支数据模型和旧快照迁移。
4. 已完成普通网页划词、悬浮入口和正文提取。
5. 下一步接入文件上传与 X / Twitter 渐进适配。
6. 完成目标网页、错误恢复和发布前验证。
