"""Save an actual capture as a local validation case and structured test receipts."""
import hashlib
import json
from pathlib import Path
import urllib.request

from server import Packet

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".data/hermes-assessment"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    packet_raw = (STATE / "packet.json").read_bytes()
    packet = Packet(packet_raw)
    receipt = json.loads((STATE / "receipt.json").read_text())
    captured = json.loads(packet.entries["test-receipt"]["content"])
    if captured != receipt:
        raise SystemExit("Receipt differs from the captured packet. Capture again before publishing.")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def post(path, body):
        data = json.dumps(body, sort_keys=True).encode()
        identity = "assessment:" + hashlib.sha256(path.encode() + data).hexdigest()
        request = urllib.request.Request("http://127.0.0.1:8178/api/v1" + path, data,
                                         {"Content-Type": "application/json", "Idempotency-Key": identity})
        with opener.open(request, timeout=20) as response:
            return json.load(response)

    case = post("/cases", {
        "title": "Platform usability and test coverage assessment",
        "project": "Repro Relay", "url": "http://127.0.0.1:5178/", "build": receipt["build"],
        "description": "Users report that investigation state and the next action are confusing, and that reviewing results requires too much repeated input. Assess the captured local interface and test coverage. " + packet.metadata["scope"] + " Packet SHA-256: " + packet.metadata["packet_sha256"],
        "expected": "Use assessment_list_evidence and assessment_read_evidence to inspect the packet, starting with test-receipt. Identify the highest-impact usability barriers with evidence IDs, exact UI labels, user impact and a proposed small correction. Triage failed, blocked and missing tests separately. Explain what cannot be concluded from snapshots, including screen-reader, physical phone and Windows behavior. Do not claim you clicked the live app or executed its tests. Return a concise assessment with priorities and evidence references; do not edit source, deliver messages, or mark fixes verified.",
    })
    results = receipt["results"]
    counts = {status: sum(r["status"] == status for r in results) for status in ["passed", "failed", "blocked", "not_run"]}
    run = post(f'/cases/{case["id"]}/inspections', {
        "revision": case["revision"], "inspector": "Local Playwright assessment capture",
        "summary": "Actual local navigation capture: " + json.dumps(counts) + ". Selected source and accessibility snapshots are prepared for a separate Hermes assessment. This record contains no Hermes execution. See Test triage for coverage boundaries.",
        "command": receipt["command"], "exit_code": 1 if counts["failed"] or counts["blocked"] else 0,
        "started_at": receipt["started_at"], "finished_at": receipt["finished_at"],
    })
    artifact = post(f'/runs/{run["id"]}/artifacts', {
        "captured_at": receipt["finished_at"], "name": "Local browser assessment receipt.json",
        "media_type": "application/json", "content": json.dumps(receipt, indent=2), "environment": results[0]["environment"],
    })
    for index, result in enumerate(results):
        post(f'/runs/{run["id"]}/journal', {
            "producer": "local-playwright-assessment", "producer_event_id": result["test_id"],
            "producer_sequence": index + 1, "captured_at": result["captured_at"], "event_type": "test_result",
            "summary": result["name"] + ": " + result["status"], "environment": result["environment"],
            "artifact_ids": [artifact["id"]],
            "data": {key: result[key] for key in ["test_id", "name", "status", "detail"]},
        })
    saved = {"case_id": case["id"], "run_id": run["id"], "packet_sha256": packet.metadata["packet_sha256"],
             "url": "http://127.0.0.1:5178/?view=agents&case=" + case["id"]}
    (STATE / "case.json").write_text(json.dumps(saved, indent=2) + "\n")
    print(json.dumps(saved, indent=2))


if __name__ == "__main__":
    main()
