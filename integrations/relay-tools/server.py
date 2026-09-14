"""Read-only Relay tools for terminal agents. MCP stdio, protocol 2025-11-25."""
import argparse
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "web/src/lib/relay-tools.json").read_text())
PROTOCOLS = {"2025-11-25", "2025-06-18"}
PERMISSIONS = {"source_writes": False, "approvals": False, "model_calls": False, "external_messages": False}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class API:
    def __init__(self, url):
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path.rstrip("/") != "/api/v1"):
            raise ValueError("Use a loopback Relay API URL ending in /api/v1.")
        self.url = url.rstrip("/") + "/autonomy"
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def feed(self):
        with self.opener.open(self.url, timeout=10) as response:
            raw = response.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError("Workspace response exceeds the tool limit.")
        return json.loads(raw)


def validate(name, args):
    tool = next((t for t in MANIFEST if t["name"] == name), None)
    if tool is None or not isinstance(args, dict):
        raise ValueError("Unknown tool or invalid arguments.")
    schema = tool["inputSchema"]
    if set(args) - set(schema["properties"]) or set(schema.get("required", [])) - set(args):
        raise ValueError("Unexpected or missing arguments.")
    if "state" in args and args["state"] not in ["all", "review", "accepted"]:
        raise ValueError("Invalid work state.")
    for key, low, high in [("limit", 1, 20), ("file_limit", 1, 20), ("file_offset", 0, 128)]:
        if key in args and (type(args[key]) is not int or not low <= args[key] <= high):
            raise ValueError("Invalid " + key + ".")
    if "audit_id" in args and (not isinstance(args["audit_id"], str) or len(args["audit_id"]) > 100
                               or not re.fullmatch(r"SCAN-[a-zA-Z0-9_-]+", args["audit_id"])):
        raise ValueError("Invalid audit ID.")


def summary(item, latest):
    return {"id": item["id"], "repository": item["repository"], "revision": item["revision"],
            "created_at": item["created_at"], "file_count": item["file_count"],
            "state": (item.get("proposal") or {}).get("state", "audit_complete"), "current_snapshot": item["id"] == latest}


def execute(api, name, args):
    validate(name, args)
    feed = api.feed()
    control = feed["control"]
    if name == "relay_workspace_status":
        return {"schema_version": 1, "repository": control["repository"], "connected": control["connected"],
                "paused": control["paused"], "last_seen": control["last_seen"], "mission": feed["mission"],
                "capabilities": feed["capabilities"], "tool_permissions": PERMISSIONS}
    if name == "relay_list_work":
        state, limit = args.get("state", "all"), args.get("limit", 5)
        found = [i for i in feed["items"] if state == "all" or (i.get("proposal") or {}).get("state") == ("pending" if state == "review" else "accepted")]
        return {"schema_version": 1, "items": [summary(i, control["latest_scan"]) for i in found[:limit]],
                "matching_in_recent_history": len(found), "returned": min(limit, len(found)), "history_limit": feed["history_limit"]}
    item = next((i for i in feed["items"] if i["id"] == args["audit_id"]), None)
    if item is None:
        raise ValueError("Audit not found in the recent workspace history.")
    offset, limit = args.get("file_offset", 0), args.get("file_limit", 10)
    return {"schema_version": 1, **summary(item, control["latest_scan"]), "instruction_bytes": item["bytes"],
            "duplicate_bytes": item["duplicate_bytes"], "proposal": item["proposal"], "files": item["files"][offset:offset + limit],
            "next_file_offset": offset + limit if offset + limit < len(item["files"]) else None,
            "review_url": "/?view=sessions&audit=" + urllib.parse.quote(item["id"], safe=""),
            "interpretation": "Recorded context diagnostics and storage evaluation. Not an independently verified code change or measured LLM token saving.",
            "tool_permissions": PERMISSIONS}


class Server:
    def __init__(self, api, manifest=MANIFEST, executor=execute, name='repro-relay'):
        self.api, self.initialized, self.ready = api, False, False
        self.manifest, self.executor, self.name = manifest, executor, name

    def handle(self, request):
        request_id = request.get("id") if isinstance(request, dict) else None
        def error(code, text):
            return {"jsonrpc": "2.0", "id": request_id if type(request_id) in (str, int) else None, "error": {"code": code, "message": text}}
        if (not isinstance(request, dict) or request.get("jsonrpc") != "2.0"
                or not isinstance(request.get("method"), str)
                or ("id" in request and type(request_id) not in (str, int))):
            return error(-32600, "Invalid request")
        method, params = request["method"], request.get("params", {})
        if "id" not in request:
            if method == "notifications/initialized" and self.initialized:
                self.ready = True
            return None
        if not isinstance(params, dict):
            return error(-32602, "Invalid params")
        if method == "initialize":
            if self.initialized:
                return error(-32600, "Already initialized")
            version = params.get("protocolVersion")
            if not isinstance(version, str):
                return error(-32602, "A protocol version is required")
            self.initialized = True
            result = {"protocolVersion": version if version in PROTOCOLS else "2025-11-25",
                      "serverInfo": {"name": self.name, "version": "0.1.0"}, "capabilities": {"tools": {"listChanged": False}}}
        elif method == "ping":
            result = {}
        elif not self.ready:
            return error(-32000, "Initialize the MCP connection first")
        elif method == "tools/list":
            result = {"tools": [{**t, "annotations": {k: v for k, v in t["annotations"].items() if k != "untrustedContentHint"}} for t in self.manifest]}
        elif method == "tools/call":
            name = params.get("name")
            if name not in [t["name"] for t in self.manifest]:
                return error(-32602, "Unknown tool")
            try:
                data = self.executor(self.api, name, params.get("arguments", {}))
                result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False, separators=(",", ":"))}], "structuredContent": data, "isError": False}
            except (OSError, ValueError, KeyError, TypeError):
                result = {"content": [{"type": "text", "text": "Could not read Relay evidence. Check arguments and the local workspace connection."}], "isError": True}
        else:
            return error(-32601, "Method not found")
        return {"jsonrpc": "2.0", "id": request_id, "result": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8178/api/v1")
    parser.add_argument("--check", action="store_true", help="Print a connection check without starting a model.")
    args = parser.parse_args()
    api = API(args.api)
    if args.check:
        print(json.dumps(execute(api, "relay_workspace_status", {}), indent=2))
        return
    server = Server(api)
    while True:
        line = sys.stdin.buffer.readline(1024 * 1024 + 1)
        if not line:
            break
        if len(line) > 1024 * 1024:
            print("MCP input exceeds 1 MiB.", file=sys.stderr)
            return
        try:
            response = server.handle(json.loads(line))
        except (ValueError, UnicodeError):
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        if response is not None:
            print(json.dumps(response, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
