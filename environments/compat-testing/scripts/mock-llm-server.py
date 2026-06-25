#!/usr/bin/env python3
"""
为 Hermes Agent E2E 测试提供的最小 OpenAI-compatible mock LLM 服务器。

行为：
- GET  /v1/models              -> 返回一个 mock model
- POST /v1/chat/completions    -> 第一轮返回 tool_calls 调用 zk_search_notes
                                  看到 tool 结果后返回最终文本

用法：
    python3 mock-llm-server.py [PORT]
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9876
MODEL = "mock-model"


def make_stream_chunk(choice):
    payload = {
        "id": "chatcmpl-mock",
        "object": "chat.completion.chunk",
        "created": 1,
        "model": MODEL,
        "choices": [choice],
    }
    return f"data: {json.dumps(payload)}\n\n"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # 抑制默认日志，避免污染测试输出
        pass

    def _send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_stream(self, chunks):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        for chunk in chunks:
            self.wfile.write(chunk.encode("utf-8"))
        self.wfile.write("data: [DONE]\n\n".encode("utf-8"))

    def do_GET(self):
        if self.path == "/v1/models":
            self._send_json(200, {
                "object": "list",
                "data": [{"id": MODEL, "object": "model"}],
            })
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self._send_json(404, {"error": "Not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        try:
            req = json.loads(body)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON"})
            return

        messages = req.get("messages", [])
        stream = req.get("stream", False)

        # 判断是否是 tool 结果后的第二轮请求
        tool_result_seen = any(m.get("role") == "tool" for m in messages)

        if not tool_result_seen:
            # 第一轮：要求调用 zk_search_notes
            choice = {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_zk_search_001",
                        "type": "function",
                        "function": {
                            "name": "zk_search_notes",
                            "arguments": json.dumps({"query": "testing", "limit": 10}),
                        },
                    }],
                },
                "finish_reason": "tool_calls",
            }
            if stream:
                chunks = [
                    make_stream_chunk({
                        "index": 0,
                        "delta": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [{
                                "index": 0,
                                "id": "call_zk_search_001",
                                "type": "function",
                                "function": {
                                    "name": "zk_search_notes",
                                    "arguments": json.dumps({"query": "testing", "limit": 10}),
                                },
                            }],
                        },
                        "finish_reason": None,
                    }),
                    make_stream_chunk({"index": 0, "delta": {}, "finish_reason": "tool_calls"}),
                ]
                self._send_stream(chunks)
            else:
                self._send_json(200, {
                    "id": "chatcmpl-mock-1",
                    "object": "chat.completion",
                    "model": MODEL,
                    "choices": [choice],
                })
        else:
            # 第二轮：返回最终结果
            choice = {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "[MOCK-LLM] Zettelkasten search completed successfully.",
                },
                "finish_reason": "stop",
            }
            if stream:
                chunks = [
                    make_stream_chunk({
                        "index": 0,
                        "delta": {"role": "assistant", "content": "[MOCK-LLM] Zettelkasten search completed successfully."},
                        "finish_reason": None,
                    }),
                    make_stream_chunk({"index": 0, "delta": {}, "finish_reason": "stop"}),
                ]
                self._send_stream(chunks)
            else:
                self._send_json(200, {
                    "id": "chatcmpl-mock-2",
                    "object": "chat.completion",
                    "model": MODEL,
                    "choices": [choice],
                })


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[mock-llm] listening on http://0.0.0.0:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
