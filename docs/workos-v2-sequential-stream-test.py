# -*- coding: utf-8 -*-
"""
影刀 AP v2：同一 Conversation 连续三轮 SSE 测试

这个脚本按逆向得到的最新协议调用：
1. 创建 Conversation
2. 每一轮先建立 SSE 订阅（GET）
3. 再提交消息（POST）
4. 按本轮 submit 返回的 runId 过滤旧的 stream-complete 事件
5. 连续发送三轮问题，每轮间隔 5 秒

依赖：
    python -m pip install requests cryptography
"""

from __future__ import annotations

import base64
import json
import os
import time
from typing import Any

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding


# ==========================
# 通过环境变量提供调试配置，禁止把真实凭证写进脚本或 Git。
# ==========================

# 如果 Network 中看到的主机不是这个地址，请替换为逆向请求的实际 host。
API_BASE = "https://power-api.yingdao.com"

ACCESS_TOKEN = os.environ.get("WORKOS_V2_ACCESS_TOKEN", "")
USER_UUID = os.environ.get("WORKOS_V2_USER_UUID", "")
ORGANIZATION_UUID = os.environ.get("WORKOS_V2_ORGANIZATION_UUID", "")
AGENT_UUID = os.environ.get(
    "WORKOS_AGENT_UUID",
    "409b06a1-2e2a-4d8c-af3c-ec831c0c6449",
)

ROUND_GAP_SECONDS = 5
SSE_TIMEOUT_SECONDS = 90


# 影刀 AP 固定的 RSA 公钥。
RSA_PUBLIC_KEY = b"""-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw+qviO5tdUjk00eaTkcE
9x8c7fEZ8LLaV7p9IzFHnNXxPW+ynQFrbEDaGJ6Oi7RZowY3BFyEHrsEkI7NXN/s
Xo3jccdaqZop5rQTFxMk4Y1LF7bJFKkcIIqRnRQ/y//RNMB4l15LK3ugrNCvHauC
6Q8bXIcCq/glNPnlK+ZQY4ezQnyLm2r856IHsEeZ3uZfcYRlMm12xHt9XDMZLG6o
VT/jdgS3h0L5c5S459DL9YiqQuDOQEojhjzvhAUljGVB6op0PqyUgL4VjvXPI0Jf
YWk7HCl6dDnEIiXy/R8FtG5bAdP4uKR+aea+AIxjnhCwvoEa1GG+L6T0OPdzZcKy
1QIDAQAB
-----END PUBLIC KEY-----"""


PUBLIC_KEY = serialization.load_pem_public_key(RSA_PUBLIC_KEY)


def encrypt_uuid(value: str) -> str:
    """使用 RSA PKCS#1 v1.5 加密 UUID，并返回 Base64 字符串。"""
    if not value:
        raise ValueError("USER_UUID / ORGANIZATION_UUID 不能为空")
    encrypted = PUBLIC_KEY.encrypt(value.encode("utf-8"), padding.PKCS1v15())
    return base64.b64encode(encrypted).decode("ascii")


def auth_headers(*, accept: str = "application/json") -> dict[str, str]:
    """每次请求重新生成认证头；RSA PKCS#1 v1.5 的随机填充会使密文每次不同。"""
    if not ACCESS_TOKEN:
        raise ValueError("请设置 WORKOS_V2_ACCESS_TOKEN 环境变量")
    return {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "x-organization-uuid": encrypt_uuid(ORGANIZATION_UUID),
        "x-user-uuid": encrypt_uuid(USER_UUID),
        "Content-Type": "application/json",
        "Accept": accept,
    }


def response_json(response: requests.Response) -> dict[str, Any] | None:
    """尽量解析 JSON；解析失败时返回 None，便于打印原始响应。"""
    try:
        value = response.json()
        return value if isinstance(value, dict) else {"value": value}
    except ValueError:
        return None


def create_conversation(session: requests.Session) -> str:
    url = f"{API_BASE.rstrip('/')}/api/agent/v2/conversations/create"
    payload = {
        "agentType": "custom_agent",
        "agentUuid": AGENT_UUID,
        "mode": "draft",
    }

    response = session.post(url, headers=auth_headers(), json=payload, timeout=30)
    print(f"创建 Conversation：HTTP {response.status_code}")
    print(f"创建响应：{response.text[:1000]}\n")
    response.raise_for_status()

    data = response_json(response) or {}
    if not data.get("success"):
        raise RuntimeError(f"创建 Conversation 失败：{data}")

    conversation_uuid = data.get("data", {}).get("conversationUuid")
    if not conversation_uuid:
        raise RuntimeError(f"创建响应中没有 conversationUuid：{data}")
    print(f"conversationUuid：{conversation_uuid}\n")
    return conversation_uuid


def find_run_id(value: Any) -> str | None:
    """递归寻找 JSON 对象中的 runId，兼容 data 是 JSON 字符串的情况。"""
    if isinstance(value, dict):
        run_id = value.get("runId")
        if isinstance(run_id, str) and run_id:
            return run_id
        for child in value.values():
            found = find_run_id(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_run_id(child)
            if found:
                return found
    elif isinstance(value, str):
        text = value.strip()
        if text.startswith("{") or text.startswith("["):
            try:
                return find_run_id(json.loads(text))
            except ValueError:
                pass
    return None


def find_texts(value: Any, output: list[str]) -> None:
    """递归收集事件中的 text 字段，用于观察是否出现 Agent 正文。"""
    if isinstance(value, dict):
        text = value.get("text")
        if isinstance(text, str) and text:
            output.append(text)
        for child in value.values():
            find_texts(child, output)
    elif isinstance(value, list):
        for child in value:
            find_texts(child, output)
    elif isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                find_texts(json.loads(stripped), output)
            except ValueError:
                pass


def submit_message(
    session: requests.Session,
    conversation_uuid: str,
    question: str,
) -> tuple[requests.Response, str | None]:
    url = (
        f"{API_BASE.rstrip('/')}/api/agent/v2/conversations/"
        f"{conversation_uuid}/queue/submit"
    )
    payload = {"parts": [{"type": "text", "text": question}]}

    response = session.post(url, headers=auth_headers(), json=payload, timeout=30)
    print(f"提交消息：HTTP {response.status_code}")
    print(f"提交响应：{response.text[:1500]}")
    response.raise_for_status()

    data = response_json(response)
    run_id = find_run_id(data)
    print(f"本轮 submit 返回的 runId：{run_id or '<未返回>'}\n")
    return response, run_id


def read_one_sse_round(
    session: requests.Session,
    conversation_uuid: str,
    question: str,
    round_no: int,
) -> None:
    subscribe_url = (
        f"{API_BASE.rstrip('/')}/api/agent/v2/conversations/"
        f"{conversation_uuid}/events/messages/subscribe"
    )

    print("=" * 78)
    print(f"第 {round_no} 轮问题：{question}")
    print("先建立 SSE 订阅，再提交消息……")

    subscribe_headers = auth_headers(accept="text/event-stream")
    subscribe_headers["Cache-Control"] = "no-cache"
    subscribe_headers["Connection"] = "keep-alive"

    # GET stream=True 在收到响应头后返回；此时连接保持打开，再提交消息，避免错过早期事件。
    with session.get(
        subscribe_url,
        headers=subscribe_headers,
        stream=True,
        timeout=(30, SSE_TIMEOUT_SECONDS),
    ) as sse_response:
        print(f"订阅响应：HTTP {sse_response.status_code}")
        sse_response.raise_for_status()

        _, expected_run_id = submit_message(session, conversation_uuid, question)

        current_event = ""
        current_data: list[str] = []
        all_texts: list[str] = []
        completed = False
        event_count = 0

        def flush_event() -> bool:
            nonlocal current_event, current_data, event_count, completed
            if not current_event and not current_data:
                return False

            data_text = "\n".join(current_data)
            event_count += 1
            parsed: Any = None
            if data_text:
                try:
                    parsed = json.loads(data_text)
                except ValueError:
                    parsed = data_text

            event_run_id = find_run_id(parsed)
            print(f"[SSE {event_count}] event={current_event or '<默认>'}, runId={event_run_id or '-'}")

            if current_event in {"message", "xybot-message"}:
                before = len(all_texts)
                find_texts(parsed, all_texts)
                if len(all_texts) > before:
                    # 只打印新增文本的最后一项，避免增量事件刷屏。
                    print(f"  text：{all_texts[-1]}")
            elif current_event == "xybot-stream-complete":
                if expected_run_id and event_run_id and event_run_id != expected_run_id:
                    print(
                        "  忽略旧完成事件："
                        f"event runId={event_run_id}, expected={expected_run_id}"
                    )
                else:
                    completed = True
                    print("  收到本轮完成事件")

            current_event = ""
            current_data = []
            return completed

        for raw_line in sse_response.iter_lines(decode_unicode=False):
            if isinstance(raw_line, bytes):
                raw_line = raw_line.decode("utf-8", errors="replace")

            # 空行表示一个 SSE 事件结束。
            if raw_line == "":
                if flush_event():
                    break
                continue

            # SSE 注释/心跳，例如 ": ping"，不属于业务事件。
            if raw_line.startswith(":"):
                continue
            if raw_line.startswith("event:"):
                current_event = raw_line[len("event:"):].strip()
            elif raw_line.startswith("data:"):
                current_data.append(raw_line[len("data:"):].lstrip())
            # id: 是 SSE 事件 ID，不是 WorkOS 的 runId，这里仅用于原始观察时忽略。

        # 某些服务端可能在 EOF 前没有补最后一个空行。
        if current_event or current_data:
            flush_event()

        print("\n本轮结果：")
        print(f"  SSE 事件数量：{event_count}")
        print(f"  是否收到完成事件：{'是' if completed else '否'}")
        print(f"  收集到的 text 字段数量：{len(all_texts)}")
        if all_texts:
            print(f"  最后一个 text：{all_texts[-1]}")
        else:
            print("  没有从 SSE 中提取到 text 字段")


def main() -> None:
    questions = [
        "Please reply with exactly this text and nothing else: YEMAI-V2-ALPHA-001",
        "Please reply with exactly this text and nothing else: YEMAI-V2-BETA-002",
        "Please reply with exactly this text and nothing else: YEMAI-V2-GAMMA-003",
    ]

    with requests.Session() as session:
        conversation_uuid = create_conversation(session)
        for index, question in enumerate(questions, start=1):
            read_one_sse_round(session, conversation_uuid, question, index)
            if index != len(questions):
                print(f"\n等待 {ROUND_GAP_SECONDS} 秒后发送下一轮……")
                time.sleep(ROUND_GAP_SECONDS)


if __name__ == "__main__":
    main()
