# WorkOS 网页端流式接口接入文档

> 核验基线：页脉 `internal-v2` 实现；2026-09-27 从新 WorkOS 页面请求核对创建、消息订阅和提交路径，扩展的连接测试及原有本地对话收发由用户在 Chrome 中验证通过。
> 接口性质：WorkOS 网页端内部协议，非官方开放 API
> 适用目标：在另一个受控项目中复用 WorkOS 网页端的多轮流式调用

## 1. 先读结论

WorkOS 网页端的流式调用不是“一次 POST 返回 SSE”，而是两个并行配合的请求：

1. 先对当前 Conversation 建立 SSE 订阅；
2. 订阅建立成功后，再 POST 提交消息；
3. 从提交响应中取得本轮 `runId`；
4. 在 Conversation 级事件流中只消费本轮事件；
5. 收到本轮完成事件后主动关闭订阅。

```text
Client                    WorkOS
  |                         |
  |-- GET subscribe ------->|  先建立 Conversation 级 SSE
  |<-- 200 event-stream ----|
  |                         |
  |-- POST queue/submit --->|  再提交本轮消息
  |<-- JSON: runId ---------|
  |                         |
  |<-- message events ------|  可能混有旧 run 的事件
  |<-- complete(runId) -----|
  |-- close stream -------->|
```

以下约束不能省略：

- 不要使用 `EventSource`：它无法携带这里需要的自定义认证 Header；使用 `fetch()` 读取 `Response.body`。
- 同一个 Conversation 只允许一轮请求处于运行中。部分正文事件不携带 `runId`，并发订阅时无法可靠归属。
- 必须先订阅、后提交，否则可能错过最早的增量事件。
- 必须用 `queue/submit` 返回的 `runId` 过滤明确属于其他 run 的事件。
- 只有属于当前 `runId` 的完成事件才能结束本轮。
- 提交成功后的断流、超时或本地停止都不能自动重提，否则可能重复执行 Agent 或工具。

新工作台还会建立 `events/changes/subscribe` 订阅；页脉当前只消费回答所需的 `events/messages/subscribe`。新增订阅是否影响其他页面能力，尚未验证。

## 2. 风险边界与推荐部署方式

接口根地址：

```text
https://workos-api.yingdao.com
```

这套 `/api/workos-agent-server/v2` 协议来自 WorkOS 网页端，不是 `/oapi` 官方开放接口。它依赖登录态凭证、网页端 RSA 公钥和内部路径，WorkOS 更新后可能随时失效。

普通网站前端不建议直接调用，原因包括：

- 浏览器页面会暴露 WorkOS 登录 Access Token；
- 目标服务是否允许你的网页 Origin 跨域调用并无稳定承诺；
- 登录 Token 过期、内部 Header 或 RSA 公钥变化时需要统一处理；
- 前端自动重试容易造成重复运行。

推荐把本协议封装在自有 BFF/后端中，由业务前端只调用你自己的稳定接口。Chrome 扩展可以在声明 `https://workos-api.yingdao.com/*` host permission 后直接请求；普通网页不能假设具有相同的跨域能力。

如果另一个项目确实是个人使用的 Chrome 扩展或受控桌面 WebView，可以复用本文的前端实现，但仍要把内部协议集中封装在一个 transport 模块中。

## 3. 所需配置

| 字段 | 来源 | 用途 |
| --- | --- | --- |
| `agentUuid` | WorkOS Agent 页面或发布信息 | 创建指定自定义 Agent 的 Conversation |
| `accessToken` | 已登录 WorkOS 页面的 `localStorage.accessToken` | Bearer 登录鉴权 |
| `userUuid` | 已登录 WorkOS 页面的 `localStorage.uuid` | 生成加密的用户身份 Header |
| `organizationUuid` | 已登录 WorkOS 页面的 `localStorage.organizationUuid` | 生成加密的组织身份 Header |

凭证只应在用户主动授权后，从以下固定 Origin 读取：

```text
https://workos.yingdao.com
```

不要把任何真实凭证写入源码、日志、错误信息、测试快照或版本库。遇到 `401` 或 `403` 时只提示重新登录或更新凭证，不回显响应中的敏感详情。

## 4. 认证 Header

每个 API 请求都需要：

```http
Authorization: Bearer <accessToken>
xybot-authorization: <accessToken>
x-user-uuid: <RSA_PKCS1_v1_5_BASE64(userUuid)>
x-organization-uuid: <RSA_PKCS1_v1_5_BASE64(organizationUuid)>
Content-Type: application/json; charset=utf-8
Accept: application/json
```

订阅 SSE 时改为：

```http
Accept: text/event-stream
Cache-Control: no-cache
```

`x-user-uuid` 与 `x-organization-uuid` 不是明文 UUID。它们要分别使用下面的 RSA 公钥执行 PKCS#1 v1.5 加密，再进行 Base64 编码：

```pem
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw+qviO5tdUjk00eaTkcE
9x8c7fEZ8LLaV7p9IzFHnNXxPW+ynQFrbEDaGJ6Oi7RZowY3BFyEHrsEkI7NXN/s
Xo3jccdaqZop5rQTFxMk4Y1LF7bJFKkcIIqRnRQ/y//RNMB4l15LK3ugrNCvHauC
6Q8bXIcCq/glNPnlK+ZQY4ezQnyLm2r856IHsEeZ3uZfcYRlMm12xHt9XDMZLG6o
VT/jdgS3h0L5c5S459DL9YiqQuDOQEojhjzvhAUljGVB6op0PqyUgL4VjvXPI0Jf
YWk7HCl6dDnEIiXy/R8FtG5bAdP4uKR+aea+AIxjnhCwvoEa1GG+L6T0OPdzZcKy
1QIDAQAB
-----END PUBLIC KEY-----
```

注意：

- 要使用 RSA PKCS#1 v1.5，不是 RSA-OAEP。
- 浏览器原生 Web Crypto 不提供 RSAES-PKCS1-v1_5 加密，可使用 `jsencrypt`。
- PKCS#1 v1.5 带随机填充，同一个 UUID 每次生成不同密文是正常现象。
- 建议每次请求重新生成两个身份 Header，不要依赖缓存后的密文。

TypeScript 示例：

```ts
import { JSEncrypt } from 'jsencrypt';

const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw+qviO5tdUjk00eaTkcE
9x8c7fEZ8LLaV7p9IzFHnNXxPW+ynQFrbEDaGJ6Oi7RZowY3BFyEHrsEkI7NXN/s
Xo3jccdaqZop5rQTFxMk4Y1LF7bJFKkcIIqRnRQ/y//RNMB4l15LK3ugrNCvHauC
6Q8bXIcCq/glNPnlK+ZQY4ezQnyLm2r856IHsEeZ3uZfcYRlMm12xHt9XDMZLG6o
VT/jdgS3h0L5c5S459DL9YiqQuDOQEojhjzvhAUljGVB6op0PqyUgL4VjvXPI0Jf
YWk7HCl6dDnEIiXy/R8FtG5bAdP4uKR+aea+AIxjnhCwvoEa1GG+L6T0OPdzZcKy
1QIDAQAB
-----END PUBLIC KEY-----`;

type Credentials = {
  accessToken: string;
  userUuid: string;
  organizationUuid: string;
};

function encryptIdentity(value: string): string {
  const encryptor = new JSEncrypt();
  encryptor.setPublicKey(RSA_PUBLIC_KEY);
  const result = encryptor.encrypt(value);
  if (!result) throw new Error('WorkOS 身份 Header 生成失败');
  return result;
}

function authHeaders(credentials: Credentials, accept = 'application/json') {
  return {
    Authorization: `Bearer ${credentials.accessToken}`,
    'xybot-authorization': credentials.accessToken,
    'x-user-uuid': encryptIdentity(credentials.userUuid),
    'x-organization-uuid': encryptIdentity(credentials.organizationUuid),
    'Content-Type': 'application/json; charset=utf-8',
    Accept: accept,
  };
}
```

## 5. 通用 JSON 响应信封

目前观察到的非流式响应采用下列结构：

```ts
type WorkosEnvelope<T> = {
  success?: boolean;
  code?: number | string;
  data?: T;
  message?: string;
  msg?: string;
};
```

不能只判断 HTTP 状态。以下任意条件都应视为失败：

- HTTP `response.ok === false`；
- `success === false`；
- 数字化后的 `code` 既不是 `0` 也不是 `200`。

常见状态建议映射：

| 状态 | 客户端语义 |
| --- | --- |
| `401` / `403` | 登录凭证无效或过期，要求重新获取 |
| `404` | Conversation 不存在，应新建 Conversation |
| `429` | 请求过于频繁，稍后再试；确认未提交后才可重试 |
| `5xx` | WorkOS 暂时不可用 |

## 6. 创建 Conversation

### 请求

```http
POST /api/workos-agent-server/v2/conversations/create
Accept: application/json
Content-Type: application/json; charset=utf-8
```

```json
{
  "agentType": "custom_agent",
  "agentUuid": "<agentUuid>",
  "mode": "draft"
}
```

### 成功响应

```json
{
  "success": true,
  "code": 200,
  "data": {
    "conversationUuid": "<conversationUuid>"
  }
}
```

后续订阅、提交、表单回复都使用这里取得的 `conversationUuid`。不要在切换 Agent 或切换认证通道后继续复用旧 Conversation。

## 7. 执行一轮流式消息

### 7.1 先建立 Conversation 级 SSE 订阅

```http
GET /api/workos-agent-server/v2/conversations/{conversationUuid}/events/messages/subscribe
Accept: text/event-stream
Cache-Control: no-cache
```

成功条件：

- HTTP 状态成功；
- 响应存在可读取的 body；
- 响应不是 JSON 错误信封。

不要等待首个业务事件才提交消息。`fetch()` 在收到响应头后返回，此时拿到 `Response.body` 即可进行下一步提交。

### 7.2 再提交消息

```http
POST /api/workos-agent-server/v2/conversations/{conversationUuid}/queue/submit
Accept: application/json
Content-Type: application/json; charset=utf-8
```

纯文本请求：

```json
{
  "parts": [
    {
      "type": "text",
      "text": "请总结这篇文章"
    }
  ]
}
```

带附件请求：

```json
{
  "parts": [
    {
      "type": "text",
      "text": "请分析附件"
    },
    {
      "type": "file",
      "url": "<上传后取得的 readUrl>",
      "filename": "report.pdf",
      "mime": "application/pdf"
    }
  ]
}
```

提交响应的 `data` 中应包含 `runId`。由于已观察到 `data` 可能嵌套或是 JSON 字符串，建议递归寻找第一个非空 `runId`，不要只读取固定的一层路径。

```ts
function findRunId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRunId(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.runId === 'string' && record.runId) return record.runId;
    for (const item of Object.values(record)) {
      const found = findRunId(item);
      if (found) return found;
    }
  }
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { return findRunId(JSON.parse(value)); } catch { /* 非 JSON 字符串 */ }
  }
  return undefined;
}
```

如果提交返回成功但没有 `runId`，本轮状态是“不确定”：停止读取并向用户报错，但不要自动重新提交。

## 8. SSE 帧与事件载荷

标准帧以空行结束：

```text
event: message
data: {"runId":"run_xxx","data":"{\"type\":\"message.part.delta\",\"properties\":{...}}"}

```

处理规则：

- 同一事件可有多行 `data:`，用换行拼接后再解析；
- `\r\n` 与 `\n` 都要支持；
- 忽略以 `:` 开头的心跳或注释行；
- `id:` 是 SSE 事件 ID，不是 WorkOS `runId`；
- `data` 可能是 JSON、JSON 字符串，或再包一层 `{ data: ... }`，建议最多递归解包 4 层；
- `data: [DONE]` 可作为兼容性完成信号，但当前 v2 的可靠完成依据仍是带本轮 `runId` 的完成事件。

典型外层信封：

```ts
type SseEnvelope = {
  runId?: string;
  runID?: string;
  data?: unknown;
};
```

解包后的典型业务事件：

```ts
type WorkosEvent = {
  type?: string;
  event?: string;
  name?: string;
  properties?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};
```

### 8.1 正文 part 初始化或快照

```json
{
  "type": "message.part.updated",
  "properties": {
    "part": {
      "id": "answer-part-id",
      "messageID": "assistant-message-id",
      "type": "text",
      "text": "当前完整快照"
    }
  }
}
```

`text` 是该 part 当前的完整快照，应覆盖本地该 part 的旧值。

### 8.2 正文增量

```json
{
  "type": "message.part.delta",
  "properties": {
    "partID": "answer-part-id",
    "messageID": "assistant-message-id",
    "field": "text",
    "delta": "新增文本"
  }
}
```

只有 `field` 缺失或等于 `text` 时才拼接。增量可能先于 `message.part.updated` 到达，因此要按 `partID` 暂存未知类型的 delta；确认该 part 是 `text` 后再合并。

不要展示 `reasoning` 类型的 part，也不要把原始工具参数、工具输出直接传给 UI。

### 8.3 消息状态

```json
{
  "type": "message.updated",
  "properties": {
    "info": {
      "id": "assistant-message-id",
      "role": "assistant",
      "finish": "stop"
    }
  }
}
```

当 `finish` 为 `tool-calls` 时，这通常是工具调用前的中间 assistant 消息，不应覆盖最终回答。一个稳妥做法是按消息到达顺序保存各自的 text parts，并显示最新的、`finish !== "tool-calls"` 的消息。

### 8.4 运行终态

```json
{
  "type": "run.terminal",
  "properties": {
    "status": "failed",
    "message": "执行失败原因"
  }
}
```

已兼容的成功状态包括：`finished`、`finish`、`successful`、`succeeded`、`ok`、`completed`、`complete`、`success`、`done`。其他明确的终态应按失败处理。

### 8.5 流完成

可能出现：

```text
event: xybot-stream-complete
data: {"runId":"run_xxx"}
```

或解包后的业务类型：

```json
{ "type": "stream.complete", "properties": {} }
```

只有事件中明确的 `runId` 与 `queue/submit` 返回的本轮 `runId` 相等时，才能可靠结束本轮。明确携带其他 `runId` 的任何事件都要忽略。

正文事件有时完全不带 `runId`。在遵守“同一 Conversation 串行单飞”的前提下，可以接收订阅建立后出现的无 `runId` 正文事件；这也是不能在同一 Conversation 并发执行的根本原因。

## 9. 可直接复用的 TypeScript 调用骨架

下面的骨架覆盖建立订阅、提交消息、按 `runId` 过滤、UTF-8 流式解码和停止。`consumeBusinessEvent` 需要按上一节实现正文 part 聚合。

```ts
const API_BASE = 'https://workos-api.yingdao.com';

type ExecuteInput = {
  content: string;
  attachments?: Array<{ url: string; filename: string; mime?: string }>;
};

type StreamHandlers = {
  onEvent: (event: unknown) => void;
  onComplete?: () => void;
};

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

function unwrapPayload(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === 'string') {
      const parsed = parseJson(current);
      if (parsed === current) break;
      current = parsed;
      continue;
    }
    if (current && typeof current === 'object' && 'data' in current) {
      const data = (current as Record<string, unknown>).data;
      if (typeof data === 'string' || (data && typeof data === 'object')) {
        current = typeof data === 'string' ? parseJson(data) : data;
        continue;
      }
    }
    break;
  }
  return current;
}

function envelopeRunId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const runId = record.runId ?? record.runID;
  return typeof runId === 'string' && runId ? runId : undefined;
}

function businessEventType(value: unknown, sseEventName = ''): string {
  if (!value || typeof value !== 'object') return sseEventName;
  const record = value as Record<string, unknown>;
  for (const key of ['type', 'event', 'name']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return sseEventName;
}

export async function executeWorkosWebStream(
  credentials: Credentials,
  conversationUuid: string,
  input: ExecuteInput,
  handlers: StreamHandlers,
  outerSignal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (outerSignal?.aborted) throw new DOMException('Stopped', 'AbortError');
  outerSignal?.addEventListener('abort', abort, { once: true });

  const encodedConversation = encodeURIComponent(conversationUuid);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const subscription = await fetch(
      `${API_BASE}/api/workos-agent-server/v2/conversations/${encodedConversation}/events/messages/subscribe`,
      {
        method: 'GET',
        headers: {
          ...authHeaders(credentials, 'text/event-stream'),
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      },
    );
    if (!subscription.ok || !subscription.body) {
      throw new Error(`WorkOS SSE 订阅失败：HTTP ${subscription.status}`);
    }
    if ((subscription.headers.get('content-type') ?? '').includes('application/json')) {
      throw new Error('WorkOS 返回了 JSON，而不是 SSE 订阅');
    }
    reader = subscription.body.getReader();

    const parts: Array<Record<string, string>> = [
      { type: 'text', text: input.content },
      ...(input.attachments ?? []).map((file) => ({
        type: 'file',
        url: file.url,
        filename: file.filename,
        ...(file.mime ? { mime: file.mime } : {}),
      })),
    ];
    const submitted = await fetch(
      `${API_BASE}/api/workos-agent-server/v2/conversations/${encodedConversation}/queue/submit`,
      {
        method: 'POST',
        headers: authHeaders(credentials),
        body: JSON.stringify({ parts }),
        signal: controller.signal,
      },
    );
    const submitEnvelope = await submitted.json();
    if (!submitted.ok || submitEnvelope?.success === false) {
      throw new Error(`WorkOS 消息提交失败：HTTP ${submitted.status}`);
    }
    const expectedRunId = findRunId(submitEnvelope?.data);
    if (!expectedRunId) throw new Error('提交成功，但响应中没有 runId；禁止自动重提');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let complete = false;

    const processBlock = (block: string) => {
      let eventName = '';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      const dataText = dataLines.join('\n');
      if (!dataText) return;
      if (dataText === '[DONE]') {
        complete = true;
        handlers.onComplete?.();
        return;
      }

      const envelope = parseJson(dataText);
      const payload = unwrapPayload(envelope);
      const runId = envelopeRunId(envelope) ?? envelopeRunId(payload);
      if (runId && runId !== expectedRunId) return;

      const type = businessEventType(payload, eventName);
      if (type === 'xybot-stream-complete' || type === 'stream.complete') {
        // 无 runId 的完成事件不建议作为可靠终止条件。
        if (runId === expectedRunId) {
          complete = true;
          handlers.onComplete?.();
        }
        return;
      }
      handlers.onEvent(payload);
    };

    while (!complete) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        processBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processBlock(buffer);
    if (!complete) throw new Error('WorkOS SSE 在本轮完成事件前断开');
  } finally {
    controller.abort();
    outerSignal?.removeEventListener('abort', abort);
    reader?.releaseLock();
  }
}
```

这段示例刻意不提供“自动重连并重提”。安全重连需要服务端支持可验证的事件游标或按 `runId` 重新订阅；当前内部协议没有稳定保证。

## 10. 附件上传（可选）

网页端附件不是直接放进 `queue/submit` 的二进制数据。流程是先申请临时地址，再上传文件，最后把 `readUrl` 放进消息 part。

### 10.1 申请临时地址

```http
POST /api/agent/v1/module/file/getUploadTempUrl
Accept: */*
Content-Type: application/json
```

此处记录的是旧工作台的附件申请路径，新 WorkOS 页面尚未核验附件接口。它与对话的 `/api/workos-agent-server/v2` 路径分开处理。

```json
{
  "fileOriginScene": "file_embedding",
  "fileType": "file",
  "fileName": "report.pdf",
  "contentType": "application/pdf",
  "fileSize": 123456,
  "generateUniqueKey": true,
  "preserveFileName": true
}
```

响应 `data`：

```json
{
  "uploadUrl": "<临时签名 PUT 地址>",
  "readUrl": "<提交给 Agent 的长期读取地址>"
}
```

### 10.2 上传原始文件

```http
PUT <uploadUrl>
Content-Type: <原始文件 MIME>

<raw file bytes>
```

安全要求：在向服务端返回的任意 URL 上传本地文件前，必须校验其 Origin。当前已验证的存储 Origin 是：

```text
https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com
```

成功后只持久化 `readUrl`；`uploadUrl` 是临时签名地址，不写日志、不进入会话记录。把 `readUrl`、文件名和 MIME 作为 `type: "file"` part 提交。

## 11. A2UI 中断表单（可选）

以下路径已随 v2 基础路径更新，但新工作台的表单回复尚未实测。

如果 Agent 使用提问工具，SSE 中可能出现：

```json
{
  "type": "interrupt",
  "properties": {
    "id": "<requestId>",
    "sessionID": "<sessionId>",
    "type": "a2ui",
    "payload": {}
  }
}
```

回复表单：

```http
POST /api/workos-agent-server/v2/conversations/{conversationUuid}/interrupt/{requestId}/reply
Content-Type: application/json
```

```json
{
  "字段标题": "单选或文本值",
  "多选字段标题": ["选项一", "选项二"]
}
```

拒绝或跳过：

```http
POST /api/workos-agent-server/v2/conversations/{conversationUuid}/interrupt/{requestId}/reject
Content-Type: application/json

{}
```

回复或拒绝后继续读取原订阅，不要创建新一轮 `queue/submit`。

## 12. 状态机与重试策略

推荐状态机：

```text
idle
  -> subscribing
  -> submitting
  -> streaming
  -> waiting-user-input  -- reply/reject --> streaming
  -> complete

任意阶段 -- local abort --> stopped
任意阶段 -- definite failure --> failed
提交成功后断流/超时 --> uncertain（禁止自动重提）
```

重试边界：

| 失败发生点 | 是否可自动重试 | 原因 |
| --- | --- | --- |
| 建立订阅前或订阅明确失败 | 可以有限重试 | 消息尚未提交 |
| `queue/submit` 明确返回业务失败 | 视错误码决定 | 服务端是否接收需结合响应语义 |
| 提交请求网络错误、超时或成功后无 `runId` | 不可以 | 服务端可能已经开始执行 |
| streaming 中断、超时、本地停止 | 不可以自动重提 | 会造成重复回答或工具副作用 |
| `401` / `403` | 不重试 | 先更新登录凭证 |

本地 `AbortController.abort()` 只保证停止当前客户端的订阅和提交请求，不等价于取消 WorkOS 服务端已经启动的 run。

## 13. 已知故障模式与排查顺序

### 13.1 订阅返回 JSON 而不是 SSE

通常是凭证无效、Conversation 不存在或内部接口发生变化。先解析 JSON 信封中的 `code`，不要继续把它当 SSE 文本读取。

### 13.2 第二轮立即完成但没有正文

优先检查：

1. 是否误用了公开 v1 的 `POST /oapi/agent/v1/.../execute/stream`；
2. 是否在提交消息后才建立订阅；
3. 是否把旧 run 的 `xybot-stream-complete` 当成本轮完成；
4. 是否在同一 Conversation 并发执行多轮。

### 13.3 明明收到 delta，页面却不出字

检查增量是否早于 part 初始化到达。未知 part 类型的 delta 要先缓存，收到 `message.part.updated` 且确认 `type: "text"` 后再合并。

### 13.4 输出出现内部推理或敏感工具数据

客户端不应递归收集所有 `text` 字段。只投影明确的 `text` part；过滤 `reasoning` part，不把工具 `args`、`input`、`output` 或未知字段交给 UI。

### 13.5 普通网页报 CORS

这不是 SSE 解析问题。不要通过关闭浏览器安全策略解决；改用自有后端/BFF 转发，或在具有明确 host permission 的受控扩展环境中调用。

## 14. 最小验收用例

接入完成至少验证：

1. 创建 Conversation 能取得非空 `conversationUuid`；
2. 同一 Conversation 连续三轮，每轮使用唯一测试文本，均收到正确增量和本轮完成事件；
3. 在本轮事件前注入旧 `runId` 的完成事件，不会提前结束；
4. 支持 SSE chunk 在任意字节位置拆分，包括 UTF-8 中文字符边界；
5. delta 先于 part 初始化时仍能得到正确正文；
6. `reasoning` part、工具参数和原始工具输出不会进入 UI；
7. SSE 在完成事件前 EOF 时报告失败，不标记 complete；
8. 本地停止后关闭 reader，但不自动重新提交；
9. `401` / `403` 错误不回显 Access Token 或服务端敏感详情；
10. 如果使用附件，只允许向受信任的 WorkOS OSS Origin 执行 PUT。

## 15. 与公开 v1 的区别

| 项目 | 网页端内部 v2 | 官方公开 v1 |
| --- | --- | --- |
| 创建会话 | `POST /api/workos-agent-server/v2/conversations/create` | `POST /oapi/agent/v1/agents/{agentUuid}/conversations` |
| 流式执行 | 先 GET subscribe，再 POST queue/submit | 单次 POST `execute/stream` |
| 认证 | 登录 Token + 两个 RSA 身份 Header | `AP_...` API Token |
| 本轮绑定 | `queue/submit` 返回 `runId` | 当前项目实测多轮存在旧完成事件问题 |
| 稳定性承诺 | 无，网页内部协议 | 官方公开接口，但多轮 SSE 曾异常 |
| 推荐用途 | 受控个人项目、验证性接入 | 接口简单或官方支持优先的场景 |

不要把两套协议的创建结果、凭证或 Conversation 混用。若切换通道，应创建新的远程 Conversation。

## 16. 当前项目中的实现依据

- `src/services/workosInternalV2.ts`：认证、创建 Conversation、订阅、提交、`runId` 绑定和中断回复；
- `src/services/workosSse.ts`：SSE 分帧、嵌套载荷解包、正文聚合、完成与安全投影；
- `src/services/workosFileUpload.ts`：内部网页附件上传；
- `src/services/workosInternalV2.test.ts`：先订阅后提交及旧完成事件过滤测试；
- `docs/WORKOS_V2_TRANSPORT_MIGRATION.md`：引入内部 v2 的背景、边界和迁移决策。
