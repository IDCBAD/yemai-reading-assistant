# WorkOS v2 可切换传输通道迁移方案

> 决策日期：2026-08-12  
> 实施分支：`codex/workos-v2-transport`  
> 产品阶段：个人使用，不面向其他用户发布

## 1. 决策摘要

页脉保留官方公开的 v1 API，同时接入 WorkOS 当前网页端使用的内部 v2 协议，形成可切换的传输通道。

- `public-v1`：继续使用一个 `AP_...` 全局 API Token，保留官方、简单、低风险的接入方式。
- `internal-v2`：使用 WorkOS 网页端登录凭证，实现同一 Conversation 的可靠多轮真流式输出。
- 未来 `public-v2`：WorkOS 正式开放 v2 API 后，替换内部认证和内部路径；验证稳定后删除 v1 与内部 v2。

本次不是重新设计阅读会话、标签页或上下文协议，而是把 WorkOS 的执行方式限制在一个可替换的传输边界内。

## 2. 为什么需要迁移

公开 v1 接口：

```http
POST /oapi/agent/v1/conversations/{conversationUuid}/execute/stream
```

在同一个 Conversation 连续多轮调用时存在服务端 SSE 异常：第一轮正常；第二轮可能立即返回上一轮的完成事件；后续轮次可能只返回完成事件而没有正文。Agent 在 WorkOS 后台仍然完成执行，因此问题不是页脉没有提交消息，也不是前端 Markdown 或 SSE 文本解析错误。

详细证据见：

- [v1 流式问题报告](./workos-stream-issue-report.md)
- [WorkOS 流式调查与重构参考](./WORKOS_STREAMING_REFACTOR_NOTES.md)

WorkOS 最新网页端已经迁移到 v2。逆向验证发现，v2 把消息提交与事件订阅分开，并通过 `runId` 绑定本轮执行：

```text
GET  /api/agent/v2/conversations/{conversationUuid}/events/messages/subscribe
POST /api/agent/v2/conversations/{conversationUuid}/queue/submit
```

同一个 Conversation 连续三轮实测均可收到正确的增量文本和本轮完成事件。参考脚本：

- [v2 连续多轮测试](./workos-v2-sequential-stream-test.py)

## 3. 为什么不直接删除 v1

当前 v2 是 WorkOS 网页端内部接口，正式 API 尚未发布。与 v1 相比，它暂时需要：

- WorkOS 登录 Access Token；
- User UUID；
- Organization UUID；
- 按 WorkOS 网页端规则生成的 RSA PKCS#1 v1.5 身份 Header；
- 内部 `/api/agent/v2` 路径。

它可能随 WorkOS 前端更新改变，也没有第三方兼容承诺。v1 仍然具有配置简单、凭证权限更明确、接口公开等优势，因此在官方 v2 发布前保留为回退通道。

## 4. 架构边界

```text
页面引用 / 本地会话 / 请求队列 / 消息界面
                    ↓
             WorkosTransport
              ↙           ↘
       PublicV1       InternalV2
                          ↓
                  InternalV2Auth

未来：
       InternalV2Auth → PublicV2Auth
       /api/.../v2    → /oapi/.../v2
```

上层只依赖以下语义：

1. 创建远程 Conversation；
2. 流式执行一次问题；
3. 接收安全投影后的正文和工具活动；
4. 停止本地流式请求。

上层不知道 SSE 是由执行 POST 返回，还是通过独立订阅获得，也不负责生成认证 Header 或筛选 runId。

## 5. v2 执行协议

每一轮必须严格按以下顺序：

1. 先建立 Conversation 级 SSE 订阅；
2. 再向 `queue/submit` 提交消息；
3. 从提交响应取得 `expectedRunId`；
4. 忽略订阅中所有 runId 不匹配的历史事件；
5. 只把当前 run 的正文和工具活动交给 UI；
6. 只有当前 run 的完成事件可以结束本轮；
7. 本地停止时终止订阅和提交请求，不自动换通道重发。

不能在 v2 失败后自动回退 v1，因为提交可能已经成功，自动重发会导致 Agent 或工具执行两次。

## 6. 凭证与安全

当前产品仅个人使用，v2 凭证保存在扩展本地存储中，设置页默认遮挡并明确标记为实验性内部连接。

安全约束：

- Access Token、User UUID 和 Organization UUID 不进入聊天正文；
- 不写入日志、错误文本、测试快照或文档；
- 测试脚本只允许从环境变量读取真实凭证；
- 原始推理、工具参数和工具输出不进入页脉 UI；
- 导出或清理会话时不混入连接凭证；
- 出现 401/403 时只提示更新相应连接配置，不回显服务端敏感响应。

当前调试脚本曾出现过明文 Access Token。该 Token 应在继续使用前轮换；仓库只保留环境变量版本。

## 7. 通道切换语义

远程 Conversation 与创建它的传输通道绑定。切换通道后，已有本地 Conversation 不直接复用旧通道的 `remoteUuid`：

- 下一轮会在新通道创建新的远程 Conversation；
- 页脉把当前本地对话的可见语义记录作为一次性衔接上下文发送；
- 工具参数、隐藏推理和原始工具结果不会进入衔接上下文；
- 通道切换不会删除本地消息，也不会删除 WorkOS 后台历史。

## 8. 附件边界

当前只有 v1 公开了确定的文件上传接口。迁移期采用能力拆分：

- 文本执行由当前选择的 Transport 负责；
- 附件仍使用公开 v1 API Token 上传；
- 未配置 v1 API Token 时，v2 文本对话仍可用，但附件按钮不可用；
- 等官方 v2 文件接口发布或内部接口完成验证后，再把上传能力纳入 v2 Transport。

## 9. 发布与删除条件

当前默认面向个人使用，可以选择 `internal-v2` 作为日常通道，但界面必须保留实验性标识。

只有满足以下条件才彻底迁移到公开 v2：

1. WorkOS 发布正式 v2 API 文档和 API 认证方式；
2. 连续多轮、附件、停止、并发和错误处理完成真实验证；
3. 页脉只需 API 凭证，不再依赖登录 Access Token 和内部 UUID Header；
4. 官方 v2 运行稳定一段时间；
5. v1 不再承担必要回退能力。

届时删除 `PublicV1Transport` 与 `InternalV2Transport`，只保留正式 `PublicV2Transport`。

## 10. 验收标准

- v1 与 v2 可以在设置中明确切换；
- v1 原有行为没有因抽象层而改变；
- v2 同一 Conversation 至少连续三轮逐字流式输出；
- 旧 run 的完成事件不会结束当前轮；
- 不同本地 Conversation 的流不会互相覆盖；
- 快速发送通过现有队列串行处理；
- 通道切换后不会错误复用旧通道 Conversation；
- v2 缺少任意凭证时不能发送，并给出明确提示；
- v2 认证失败不会误报 v1 API Token 失效；
- v2 模式未配置 v1 Token 时只禁用附件，不禁用文本对话；
- 单元测试、TypeScript 检查和 Chrome MV3 构建全部通过。
