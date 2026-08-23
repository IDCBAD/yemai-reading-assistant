# IndexedDB 数据层迁移

## 目标

v0.3a 将本地历史从单个 `chrome.storage.local.workspaceState` 快照迁移到版本化 IndexedDB。迁移保持现有 `WorkspaceState` UI 契约，同时消除流式消息更新时反复重写完整历史的写放大。

## 存储边界

IndexedDB `yemai-reading-assistant` 保存：

- `conversations`：会话、分支、草稿和当前页面信息。
- `messages`：按会话和位置拆分的消息。
- `conversationSources`：会话中的有限页面来源、Manifest、URL 和内容版本。
- `artifacts`：Agent 输出产物元数据，不保存远程文件二进制。
- `meta`：数据库迁移状态和恢复所需的工作页备份。

`chrome.storage.local` 继续保存：

- WorkOS 连接配置和凭据。
- UI 偏好。
- `workspaceUiState`：打开的工作页和当前工作页。
- `workspaceMigrationState`：用于诊断的迁移完成信息。

完整网页 Snapshot 仍只存在于请求准备内存中，不写入 IndexedDB。

## 兼容策略

`src/services/workspaceStorage.ts` 继续暴露 `loadWorkspaceState()` 和 `saveWorkspaceState()`。Side Panel 暂时不感知底层拆表，后续搜索和分页可以直接使用 Repository 查询。

保存流程先调用现有 `createWorkspaceSnapshot()` 清理瞬态数据，再拆分为数据库行。因此 Blob 预览 URL、完整页面 Markdown 和不安全产物 URL 不会因为迁移重新进入持久化数据。

## 一次性迁移

1. 读取旧 `workspaceState`，使用现有 v1～v6 normalizer 校验并升级。
2. 在 IndexedDB 事务中写入规范化数据。
3. 同一事务写入 `data-written` 标记和工作页状态备份。
4. 从 IndexedDB 回读，核对会话数和消息数。
5. 将小型工作页状态写入 `chrome.storage.local`。
6. 把迁移标记更新为 `complete`。

如果第 3 步后 Side Panel 被关闭，下次启动会根据 `data-written` 标记恢复工作页状态并完成迁移，不会再次导入或创建重复数据。

旧 `workspaceState` 在 v0.3 的稳定观察期内保留为恢复材料。IndexedDB 一旦完成迁移就是唯一历史真源；运行时不会双写旧快照，也不会静默回退到可能过期的旧数据。

## 写入规则

- 保存请求串行执行，并合并等待期间产生的更新。
- Repository 为各表维护内容签名，只写入发生变化的实体。
- 从 WorkspaceState 消失的消息、来源、会话和产物在同一事务中删除。
- UI 状态只在数据库事务成功后更新，避免工作页指向尚未落盘的会话。
- 只有打开工作页或当前工作页发生变化时才重写 UI 状态；消息流更新不会持续写 `chrome.storage.local`。

## 发布与回滚

首个版本保留旧快照，不主动删除。验证迁移、重启、长会话和清空历史稳定后，再在后续 schema 版本中增加旧快照清理任务。

遇到数据库读取失败时，应用应报告恢复错误，不能把空白初始工作区保存回数据库覆盖已有历史。
