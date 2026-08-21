#!/usr/bin/env python3
"""Smoke-test a deployed Free AI Gateway using the OpenAI Python SDK.

Usage:
  python3 scripts/test_deployed_openai_sdk.py \
    --gateway-base-url https://ai-gateway.sassmaker.com

Provide --api-key, GATEWAY_API_KEY, or OPENAI_API_KEY before running.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass


@dataclass
class SmokeResult:
    ok: bool
    token_preview: str
    chat_text: str
    responses_text: str
    stream_text: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-test deployed gateway with OpenAI SDK")
    parser.add_argument(
        "--gateway-base-url",
        default="https://ai-gateway.sassmaker.com",
        help="Gateway root URL (without /v1)",
    )
    parser.add_argument(
        "--api-base-url",
        default="",
        help="Override OpenAI SDK base URL (defaults to <gateway>/v1)",
    )
    parser.add_argument("--api-key", default="", help="Gateway API key to use")
    parser.add_argument(
        "--force-provider",
        default="",
        choices=["", "workers_ai", "groq", "gemini", "openrouter", "cerebras"],
        help="Optional x-gateway-force-provider header",
    )
    parser.add_argument(
        "--chat-prompt",
        default="Reply with exactly: PY_CHAT_OK",
        help="Prompt used for chat.completions test",
    )
    parser.add_argument(
        "--responses-input",
        default="Reply with exactly: PY_RESPONSES_OK",
        help="Input used for responses.create test",
    )
    parser.add_argument(
        "--stream-prompt",
        default="Reply with exactly: PY_STREAM_OK",
        help="Prompt used for streaming chat test",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=45,
        help="OpenAI SDK timeout in seconds",
    )
    parser.add_argument(
        "--skip-stream",
        action="store_true",
        help="Skip stream test",
    )
    return parser.parse_args()


def build_extra_headers(force_provider: str) -> dict[str, str]:
    headers = {"x-gateway-project-id": "python_test_runner"}
    if force_provider:
        headers["x-gateway-force-provider"] = force_provider
    return headers


def _run_stream_test(client, args, extra_headers) -> str:
    if args.skip_stream:
        return ""
    chunks: list[str] = []
    stream = client.chat.completions.create(
        model="auto",
        messages=[{"role": "user", "content": args.stream_prompt}],
        stream=True,
        extra_headers=extra_headers,
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta and delta.content:
            chunks.append(delta.content)
    return "".join(chunks).strip()


def run_smoke(args: argparse.Namespace) -> SmokeResult:
    try:
        from openai import OpenAI
    except Exception as exc:  # pragma: no cover - startup dependency guard
        raise RuntimeError(
            "Missing dependency 'openai'. Install with: python3 -m pip install openai"
        ) from exc

    gateway_base_url = args.gateway_base_url.rstrip("/")
    api_base_url = args.api_base_url.rstrip("/") if args.api_base_url else f"{gateway_base_url}/v1"

    api_key = args.api_key or os.environ.get("GATEWAY_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("Provide --api-key, GATEWAY_API_KEY, or OPENAI_API_KEY before running the smoke test")

    client = OpenAI(api_key=api_key, base_url=api_base_url, timeout=args.timeout_seconds)
    extra_headers = build_extra_headers(args.force_provider)

    chat = client.chat.completions.create(
        model="auto",
        messages=[{"role": "user", "content": args.chat_prompt}],
        extra_headers=extra_headers,
    )
    chat_text = (chat.choices[0].message.content or "").strip() if chat.choices else ""

    responses = client.responses.create(
        model="auto",
        input=args.responses_input,
        extra_headers=extra_headers,
    )
    responses_text = (responses.output_text or "").strip()

    stream_text = _run_stream_test(client, args, extra_headers)

    ok = bool(chat_text and responses_text and (stream_text or args.skip_stream))
    token_preview = f"{api_key[:12]}..." if len(api_key) >= 12 else "***"

    return SmokeResult(
        ok=ok,
        token_preview=token_preview,
        chat_text=chat_text,
        responses_text=responses_text,
        stream_text=stream_text,
    )


def main() -> int:
    args = parse_args()
    try:
        result = run_smoke(args)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        return 1

    print(
        json.dumps(
            {
                "ok": result.ok,
                "token_preview": result.token_preview,
                "chat_text": result.chat_text,
                "responses_text": result.responses_text,
                "stream_text": result.stream_text,
            },
            indent=2,
            ensure_ascii=True,
        )
    )
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
