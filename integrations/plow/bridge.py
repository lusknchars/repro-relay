#!/usr/bin/env python3
"""Local Plow/Relay bridge. Standard library only; no background sends or model calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from urllib import error, parse, request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "relay-terminal"))
import private_files  # noqa: E402  (found next door, the way plow_agent finds this file)

ADAPTER = "repro-relay-plow-v1"
PLOW_ORIGIN = "https://api.plow.co"
LIMIT = 1_048_576


class BridgeError(Exception):
    pass


def protect_or_stop(path):
    """Make a path private, or stop with the reason rather than a general failure."""
    try:
        private_files.protect(path)
    except private_files.PrivacyError as error:
        raise BridgeError(str(error)) from None


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,180}", value):
        raise BridgeError("Invalid resource identifier.")
    return value


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class JsonHTTP:
    def __init__(self, origin, token=None):
        self.origin = origin
        self.token = token
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def call(self, method, path, body=None, key=None):
        if not path.startswith("/") or path.startswith("//"):
            raise BridgeError("Invalid API path.")
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        if key:
            headers["Idempotency-Key"] = key
        data = None if body is None else json.dumps(body).encode()
        req = request.Request(self.origin + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=12) as response:
                raw = response.read(LIMIT + 1)
                if len(raw) > LIMIT:
                    raise BridgeError("API response exceeded the size limit.")
                return response.status, json.loads(raw)
        except error.HTTPError as exc:
            # Never print response bodies, URLs, headers, or provider exception text.
            raise BridgeError(f"API returned HTTP {exc.code}; no automatic retry was made.") from None
        except (error.URLError, OSError, ValueError):
            raise BridgeError("API response unavailable or invalid; reconcile uncertain writes before retrying.") from None


def private_credentials(path):
    """The line token, read only from a file this account alone can reach.

    What owner-only means is asked of the host: mode bits on POSIX, the file's access list
    on Windows, where every file keeps mode 0o666 and no mode check could ever pass.
    """
    try:
        with private_files.open_private(path) as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or not private_files.is_private(path, info):
                raise BridgeError("Plow credentials must be a regular file only you can read. Run "
                                  + private_files.how_to_protect(path) + " and try again.")
            raw = source.read(16_385).decode("utf-8")
        if len(raw) > 16_384:
            raise BridgeError("Plow credential file exceeds the size limit.")
    except (OSError, UnicodeError, private_files.PrivacyError):
        raise BridgeError("Plow credential file is unavailable. Use plow-agents login, then mint a line credential.") from None
    values = {}
    for line in raw.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key in values:
            raise BridgeError("Invalid or duplicate entry in Plow credential file.")
        values[key] = value.strip()
    token = values.get("PLOW_AGENT_TOKEN", "")
    if not token or len(token) > 4096 or any(c.isspace() for c in token):
        raise BridgeError("A line-scoped PLOW_AGENT_TOKEN is required.")
    if values.get("PLOW_API_BASE", PLOW_ORIGIN).rstrip("/") != PLOW_ORIGIN:
        raise BridgeError("This bridge supports https://api.plow.co only; credentials were not sent.")
    return token


class ReceiptStore:
    def __init__(self, directory):
        self.directory = Path(directory)

    def write(self, attempt, value):
        """Record one attempt, in a folder only this account can reach.

        This code creates that folder, so this code makes it private: a mode of 0700 is
        ignored on Windows, and leaning on what a platform happens to do by default is how a
        promise goes quietly unkept. One that was already there is left as it is and refused
        if it is open to others, because it belongs to whoever made it.
        """
        identifier(attempt)
        try:
            private_files.make_private_directory(self.directory)
        except private_files.PrivacyError as error:
            raise BridgeError(str(error)) from None
        info = self.directory.lstat()
        if (self.directory.is_symlink() or not stat.S_ISDIR(info.st_mode)
                or not private_files.is_private(self.directory, info)):
            raise BridgeError("Receipt directory must be one only you can reach, and cannot be a link. Run "
                              + private_files.how_to_protect(self.directory) + " and try again.")
        fd, name = tempfile.mkstemp(prefix=".receipt-", dir=self.directory)
        try:
            with os.fdopen(fd, "w") as target:
                json.dump(value, target)
                target.flush()
                os.fsync(target.fileno())
            private_files.replace_atomically(name, self.directory / f"{attempt}.json")
            if not private_files.windows():
                # Windows cannot open a folder to flush it; the file's own fsync is what it offers.
                directory_fd = os.open(self.directory, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def read(self, attempt):
        path = self.directory / f"{identifier(attempt)}.json"
        return json.loads(path.read_text())


class Bridge:
    def __init__(self, relay, plow, line, chat, actor, receipts):
        self.relay, self.plow = relay, plow
        self.line, self.chat = identifier(line), identifier(chat)
        self.actor = {"name": actor, "role": "maintainer"}
        self.receipts = receipts

    def relay_call(self, method, path, body=None, key=None):
        return self.relay.call(method, "/api/v1" + path, body, key)

    def granted_chat(self):
        _, listing = self.plow.call("GET", "/v1/chats")
        if listing.get("has_more") is not False or not isinstance(listing.get("data"), list):
            raise BridgeError("Plow chat grant is incomplete; no action was authorized.")
        matches = [c for c in listing["data"] if c.get("uid") == self.chat]
        if len(matches) != 1 or matches[0].get("status") != "active":
            raise BridgeError("Configured Plow chat is not an active granted destination.")
        participants = matches[0].get("participants", [])
        agents = [p for p in participants if p.get("type") == "agent" and p.get("relationship") in (None, "self")]
        owners = [p for p in participants if p.get("type") == "member" and p.get("role") == "owner"]
        if len(participants) != 2 or len(agents) != 1 or len(owners) != 1:
            raise BridgeError("This bridge requires the owner's one-to-one phone chat; groups and peer agents are unsupported.")
        line = agents[0].get("line", {})
        if line.get("uid") != self.line or line.get("provider_type") != "imessage":
            raise BridgeError("Configured Plow line does not match this phone chat.")
        identifier(owners[0].get("uid"))
        return matches[0], owners[0]["uid"]

    def doctor(self):
        self.granted_chat()
        _, identity = self.plow.call("GET", "/v1/agents/cloud/me")
        if identity.get("line", {}).get("uid") != self.line:
            raise BridgeError("Credential identity does not match the configured Plow line.")
        _, runner = self.relay_call("GET", "/runner")
        return {"plow_grant_checked": True, "line_id": self.line, "chat_id": self.chat,
                "line_name": identity.get("line", {}).get("display_name"),
                "latch_advertised": bool(identity.get("mcp_url")), "latch_action_verified": False,
                "hermes_runner": runner, "phone_delivery_verified": False,
                "native_iphone_connection": "not_implemented"}

    def register_source(self, project):
        self.granted_chat()
        _, sources = self.relay_call("GET", "/intake/sources")
        matches = [s for s in sources if s["provider"] == "plow" and s["line"] == self.line and s["project"] == project and not s["revoked"]]
        if len(matches) > 1:
            raise BridgeError("Multiple existing sources match; select one explicitly.")
        if matches:
            return matches[0]
        return self.relay_call("POST", "/intake/sources", {"provider": "plow", "line": self.line, "project": project, "actor": self.actor["name"], "enabled": False})[1]

    def source(self, source_id):
        _, source = self.relay_call("GET", f"/intake/sources/{identifier(source_id)}")
        if source["provider"] != "plow" or source["line"] != self.line or source["revoked"]:
            raise BridgeError("Relay intake source does not authorize the configured Plow line.")
        return source

    def enable_source(self, source_id, version):
        self.granted_chat()
        self.source(source_id)
        return self.relay_call("POST", f"/intake/sources/{identifier(source_id)}/configuration", {"version": version, "enabled": True, "actor": self.actor["name"]})[1]

    def message(self, message_id):
        identifier(message_id)
        cursor, visited = None, set()
        for _ in range(20):
            path = f"/v1/chats/{self.chat}/messages?limit=50"
            if cursor:
                path += "&starting_after=" + identifier(cursor)
            _, listing = self.plow.call("GET", path)
            page = listing.get("data")
            if not isinstance(page, list) or not isinstance(listing.get("has_more"), bool):
                raise BridgeError("Invalid Plow history page.")
            for item in page:
                if item.get("uid") == message_id:
                    return item
            if not listing["has_more"]:
                break
            cursor = page[-1].get("uid") if page else None
            if not cursor or cursor in visited:
                raise BridgeError("Plow history cursor did not advance.")
            visited.add(cursor)
        raise BridgeError("Selected message was not found within 1,000 history entries; no report was imported.")

    def import_report(self, source_id, message_id, fields, allow_automatic=False):
        _, owner = self.granted_chat()
        source = self.source(source_id)
        if not source["enabled"]:
            raise BridgeError("Review and enable the Relay intake source first.")
        _, policy = self.relay_call("GET", "/projects/" + parse.quote(source["project"], safe="") + "/config")
        config = policy["config"]
        if config["automatic"] and not allow_automatic:
            raise BridgeError("This project queues investigations automatically. Review its policy and pass --allow-automatic to import.")
        message = self.message(message_id)
        sender = message.get("sender", {})
        if message.get("direction") != "inbound" or sender.get("type") != "member" or sender.get("uid") != owner:
            raise BridgeError("Only the configured owner's inbound message can become a report; agent echoes are rejected.")
        if not isinstance(fields, dict) or set(fields) - {"title", "url", "expected", "build"} or not {"title", "url", "expected"} <= fields.keys():
            raise BridgeError("Report fields must contain title, url, expected, and optionally build. Description comes from Plow.")
        body = message.get("body")
        if not isinstance(body, str) or not body.strip() or len(body.encode()) > 12_000:
            raise BridgeError("The selected message needs non-empty text of at most 12,000 bytes.")
        if message.get("attachments"):
            raise BridgeError("Attachment import is not implemented; review a text-only report.")
        # Keep source text unchanged. This is a report, never an automated observation.
        report = dict(fields, description=f"Plow message: {message_id}\nChat: {self.chat}\nSender: {owner}\n\n{body}")
        if len(report["description"].strip()) > 8_000:
            raise BridgeError("Message plus source attribution exceeds Relay's 8,000-character report limit. Split the report before importing.")
        result = self.relay_call("POST", f"/intake/{identifier(source_id)}/reports", {"external_message_id": message_id, "direction": "inbound", "report": report, "expected_config_version": config["version"]})[1]
        case_id = result["case"]["id"]
        return {"case_id": case_id, "receipt": result["receipt"], "case_path": f"/?view=agents&case={case_id}", "source": "plow_owner_report"}

    def delivery(self, delivery_id):
        _, value = self.relay_call("GET", f"/deliveries/{identifier(delivery_id)}")
        destination = value["destination"]
        if destination["provider"] != "plow" or destination["line"] != self.line or destination["thread"] != self.chat:
            raise BridgeError("Approved delivery destination does not match this Plow connection.")
        if digest(value["body"]) != value["body_sha256"]:
            raise BridgeError("Stored delivery body does not match its approval digest.")
        return value

    def send(self, delivery_id, version, body_sha256):
        value = self.delivery(delivery_id)
        if value["version"] != version or value["body_sha256"] != body_sha256 or value["status"] != "pending":
            raise BridgeError("Delivery changed or is not pending. Inspect the current approved delivery before sending.")
        self.granted_chat()
        status, claimed = self.relay_call("POST", f"/deliveries/{delivery_id}/claim", {"expected_version": version, "actor": self.actor, "adapter": ADAPTER}, key=f"plow-claim-{delivery_id}-{version}")
        if status != 201:
            return {"status": "not_sent", "reason": "Replayed claim grants no new provider send.", "delivery_id": delivery_id}
        attempt = identifier(claimed["attempts"][-1]["id"])
        receipt = {"delivery_id": delivery_id, "attempt_id": attempt, "expected_version": claimed["version"], "actor": self.actor, "adapter": ADAPTER, "outcome": "uncertain", "provider_message_id": None, "detail": "Dispatch outcome unknown; never resend without reconciliation."}
        # Persist the uncertain state before contacting the provider.
        self.receipts.write(attempt, receipt)
        try:
            self.granted_chat()
            if claimed["destination"] != value["destination"] or claimed["body"] != value["body"]:
                raise BridgeError("Claimed delivery differs from its approved preview.")
            _, response = self.plow.call("POST", f"/v1/chats/{self.chat}/messages", {"body": claimed["body"]})
            receipt["provider_message_id"] = identifier(response.get("uid"))
            receipt["outcome"] = "delivered"
            receipt["detail"] = "Plow accepted the approved message and returned a message ID. Recipient read status is unknown."
        except (BridgeError, KeyError, TypeError, AttributeError):
            # A timeout, bad reply, or failed preflight never authorizes a resend.
            pass
        self.receipts.write(attempt, receipt)
        return self.record_outcome(attempt)

    def record_outcome(self, attempt):
        receipt = self.receipts.read(identifier(attempt))
        delivery_id = identifier(receipt["delivery_id"])
        value = self.delivery(delivery_id)
        current = value["attempts"][-1]
        if current["id"] != attempt or current["adapter"] != ADAPTER or receipt["attempt_id"] != attempt:
            raise BridgeError("Receipt does not match the current delivery attempt.")
        if value["status"] == "delivered":
            if current.get("provider_message_id") != receipt["provider_message_id"]:
                raise BridgeError("Recorded provider receipt differs from the local receipt.")
            return {"status": "delivered", "delivery_id": delivery_id, "provider_message_id": receipt["provider_message_id"]}
        if value["status"] == "uncertain" and receipt["outcome"] == "uncertain":
            return {"status": "uncertain", "delivery_id": delivery_id, "attempt_id": attempt, "next_action": "Inspect the provider attempt; no resend was performed."}
        operation = "reconcile" if value["status"] == "uncertain" else "outcome"
        body = {k: v for k, v in receipt.items() if k != "delivery_id"}
        body["expected_version"] = value["version"]
        result = self.relay_call("POST", f"/deliveries/{delivery_id}/{operation}", body, key=f"plow-{operation}-{attempt}-{value['version']}")[1]
        return {"status": result["status"], "delivery_id": delivery_id, "attempt_id": attempt, "provider_message_id": receipt["provider_message_id"]}


def from_config(path):
    path = Path(path).resolve()
    config = json.loads(path.read_text())
    url = parse.urlsplit(config["relay_url"])
    if url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port or url.path not in ("", "/") or url.query or url.fragment or url.username or url.password:
        raise BridgeError("Relay URL must be a loopback origin such as http://127.0.0.1:8178. Remote maintainer access is unsupported.")
    token = private_credentials(path.parent / config["credentials_file"])
    return Bridge(JsonHTTP(config["relay_url"].rstrip("/")), JsonHTTP(PLOW_ORIGIN, token), config["line_id"], config["chat_id"], config["actor"], ReceiptStore(path.parent / config["state_dir"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor")
    register = commands.add_parser("register-source")
    register.add_argument("--project", required=True)
    enable = commands.add_parser("enable-source")
    enable.add_argument("--source", required=True)
    enable.add_argument("--version", type=int, required=True)
    intake = commands.add_parser("import-report")
    intake.add_argument("--source", required=True)
    intake.add_argument("--message", required=True)
    intake.add_argument("--fields", type=Path, required=True)
    intake.add_argument("--allow-automatic", action="store_true")
    preview = commands.add_parser("preview-delivery")
    preview.add_argument("--delivery", required=True)
    send = commands.add_parser("send-approved")
    send.add_argument("--delivery", required=True)
    send.add_argument("--version", type=int, required=True)
    send.add_argument("--body-sha256", required=True)
    record = commands.add_parser("record-outcome")
    record.add_argument("--attempt", required=True)
    args = parser.parse_args()
    try:
        bridge = from_config(args.config)
        if args.command == "doctor": result = bridge.doctor()
        elif args.command == "register-source": result = bridge.register_source(args.project)
        elif args.command == "enable-source": result = bridge.enable_source(args.source, args.version)
        elif args.command == "import-report": result = bridge.import_report(args.source, args.message, json.loads(args.fields.read_text()), args.allow_automatic)
        elif args.command == "preview-delivery": result = bridge.delivery(args.delivery)
        elif args.command == "send-approved": result = bridge.send(args.delivery, args.version, args.body_sha256)
        else: result = bridge.record_outcome(args.attempt)
        print(json.dumps(result, indent=2))
    except (BridgeError, OSError, ValueError, KeyError, TypeError, IndexError) as exc:
        print(str(exc) if isinstance(exc, BridgeError) else "Invalid configuration, receipt, or API response. No automatic retry was made.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
