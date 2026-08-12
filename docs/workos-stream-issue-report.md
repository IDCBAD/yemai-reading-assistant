# WorkOS 连续调用 `execute/stream` 时 SSE 流异常

> **结论先行：** 同一个 Conversation 连续发送三次请求时，第一次返回完整流；第二次返回第一轮的旧完成事件；第三次返回新的 `runId`，但没有返回正文事件。问题可以在不经过页脉插件的 Python 直连接口测试中复现。

## 测试条件

| 项目 | 内容 |
| --- | --- |
| Conversation | `ab69d196-ae26-43cd-8635-850f410914b8` |
| 接口 | `POST /oapi/agent/v1/conversations/{conversationUuid}/execute/stream` |
| 调用次数 | 3 次 |
| 调用间隔 | 约 5 秒 |
| 客户端 | Python `requests`，直接读取原始 SSE |

## 三轮结果

| 轮次 | 问题 | 返回的 `runId` | SSE 结果 | 判断 |
| --- | --- | --- | --- | --- |
| 1 | `YEMAI-STREAM-ALPHA-001` | `run_41e831df-ecdb-4d89-a44a-d6daa5129f98` | 返回完整生命周期、消息、增量文本和完成事件 | 正常 |
| 2 | `YEMAI-STREAM-BETA-002` | 仍是 `run_41e831df-ecdb-4d89-a44a-d6daa5129f98` | 只有第一轮的 `xybot-stream-complete` | 异常：复用了旧完成事件 |
| 3 | `YEMAI-STREAM-GAMMA-003` | 新的 `run_09a2f06c-85a1-4b0b-8611-68abf48846d0` | 只有一个新的 `xybot-stream-complete`，没有正文流 | 异常：新 run 没有完整事件流 |

第二轮返回的关键内容：

```text
event:xybot-stream-complete
data:{
  "conversationUuid":"ab69d196-ae26-43cd-8635-850f410914b8",
  "runId":"run_41e831df-ecdb-4d89-a44a-d6daa5129f98"
}
```

第三轮返回的关键内容：

```text
event:xybot-stream-complete
data:{
  "conversationUuid":"ab69d196-ae26-43cd-8635-850f410914b8",
  "runId":"run_09a2f06c-85a1-4b0b-8611-68abf48846d0"
}
```

第二、三轮请求都在约 `0.3 秒` 内结束，没有返回对应问题的文本增量事件。WorkOS 页面刷新后可以看到三轮内容，说明执行结果可能已经持久化，但没有通过当前 SSE 连接实时推送。

## 需要 WorkOS 确认

1. 同一个 Conversation 连续调用时，`execute/stream` 是否保证每次连接绑定到本轮新的 `runId`？
2. 第二轮为什么返回第一轮的 `runId` 和完成事件？
3. 第三轮已经有新的 `runId`，为什么没有返回该 run 的生命周期、消息和正文事件？
4. SSE 是否需要传入 `runId`、`Last-Event-ID` 或其他事件游标？
5. 如果实时流漏事件，是否可以通过 `execute/result?runId=...` 查询该 run 的完整结果？

## 事件 ID 与 runId 的区别

```text
id:1786517936628-0       # SSE 事件 ID
run_09a2f06c-...          # WorkOS Agent 执行 ID（runId）
```

本次问题不是“所有后续请求都复用了旧 `runId`”，而是同时出现了两种异常：第二轮复用了旧完成事件，第三轮使用新 `runId` 却没有返回完整事件流。
