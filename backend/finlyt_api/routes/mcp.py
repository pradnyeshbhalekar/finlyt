"""MCP server: Finlyt's read-only money tools for any MCP client (Claude Code, Claude Desktop…).

Streamable HTTP, stateless: POST JSON-RPC 2.0 to /api/mcp with "Authorization: Bearer <token>"
(Settings → Connect an AI assistant makes one). Replies are plain JSON; there's no SSE stream.
Example: claude mcp add --transport http finlyt https://finlyt-api.vercel.app/api/mcp \\
           --header "Authorization: Bearer <token>"
"""

from __future__ import annotations

import json

from flask import Blueprint, jsonify, request

from ..auth import current_user
from ..db import get_session
from ..errors import ApiError
from ..services import insights

bp = Blueprint("mcp", __name__)

VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
INSTRUCTIONS = (
    "Finlyt is the user's personal expense tracker (India, rupees, IST dates). These tools read their "
    "real data and change nothing. Use spending_summary for totals, find_expenses for individual "
    "entries, people_balances for who owes whom, budget_status for the monthly plan."
)


def _reply(msg_id, result=None, error=None):
    body = {"jsonrpc": "2.0", "id": msg_id}
    body["error" if error else "result"] = error or result
    return jsonify(body)


@bp.get("/mcp")
def mcp_stream():
    return "", 405, {"Allow": "POST"}


@bp.post("/mcp")
def mcp():
    msg = request.get_json(silent=True)
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        return _reply(None, error={"code": -32600, "message": "Invalid request"}), 400
    method, msg_id, params = msg["method"], msg.get("id"), msg.get("params") or {}
    if msg_id is None:  # a notification, e.g. notifications/initialized
        return "", 202

    if method == "initialize":
        asked = params.get("protocolVersion")
        return _reply(
            msg_id,
            {
                "protocolVersion": asked if asked in VERSIONS else VERSIONS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "finlyt", "title": "Finlyt", "version": "0.1.0"},
                "instructions": INSTRUCTIONS,
            },
        )
    if method == "ping":
        return _reply(msg_id, {})
    if method == "tools/list":
        return _reply(
            msg_id,
            {
                "tools": [
                    {
                        "name": t.name,
                        "description": t.description,
                        "inputSchema": t.input_schema,
                        "annotations": {"readOnlyHint": True, "openWorldHint": False},
                    }
                    for t in insights.TOOLS
                ]
            },
        )
    if method == "tools/call":
        name = params.get("name")
        try:
            data = insights.call(get_session(), current_user().id, name, params.get("arguments"))
        except ApiError as e:
            return _reply(msg_id, {"content": [{"type": "text", "text": e.message}], "isError": True})
        return _reply(
            msg_id,
            {
                "content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}],
                "structuredContent": data,
                "isError": False,
            },
        )
    return _reply(msg_id, error={"code": -32601, "message": f"Method not found: {method}"})
