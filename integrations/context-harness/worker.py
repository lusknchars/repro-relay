"""Local context harness v1. Reads tracked instructions; never edits a checkout."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time
import posixpath
import re
try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib
    except ImportError:
        try:
            from pip._vendor import tomli as tomllib
        except ImportError:
            tomllib = None
import urllib.error
import urllib.parse
import urllib.request

NAMES = {"AGENTS.md", "CLAUDE.md", "SKILL.md"}


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10).stdout


def snapshot(root):
    root = pathlib.Path(root).resolve(strict=True)
    if pathlib.Path(git(root, "rev-parse", "--show-toplevel").decode().strip()).resolve() != root:
        raise ValueError("Choose the repository root.")
    revision = git(root, "rev-parse", "HEAD").decode().strip()
    files = []
    total = 0
    for record in git(root, "ls-files", "--stage", "-z").split(b"\0"):
        if not record:
            continue
        meta, raw = record.split(b"\t", 1)
        path = raw.decode("utf-8")
        if pathlib.PurePosixPath(path).name not in NAMES:
            continue
        mode, _, stage = meta.split()
        if stage != b"0":
            raise ValueError("Resolve instruction-file merge conflicts before scanning.")
        if mode not in {b"100644", b"100755"}:
            raise ValueError("Instruction symlinks are outside this harness scope.")
        candidate = root / path
        if not candidate.exists():
            continue  # A tracked deletion is reflected in the new inventory.
        if any(p.is_symlink() for p in [candidate, *candidate.parents] if p != root):
            raise ValueError("Instruction symlinks are outside this harness scope.")
        if not candidate.resolve().is_relative_to(root):
            raise ValueError("Instruction path leaves the repository.")
        with candidate.open("rb") as stream:
            data = stream.read(64 * 1024 + 1)
        if len(data) > 64 * 1024:
            raise ValueError("An instruction file exceeds 64 KiB.")
        total += len(data)
        files.append({"path": path, "content": data.decode("utf-8")})
        if len(files) > 128 or total > 256 * 1024:
            raise ValueError("Instruction inventory exceeds the harness limits.")
    if git(root, "rev-parse", "HEAD").decode().strip() != revision:
        raise ValueError("Repository revision changed during inspection; scan again.")
    return {"repository": root.name + " · " + hashlib.sha256(str(root).encode()).hexdigest()[:8],
            "revision": revision, "files": sorted(files, key=lambda f: f["path"])}


def contribution_snapshot(root):
    """Latest commits on HEAD. Names/subjects only: no email, diff, source or untracked files."""
    root = pathlib.Path(root).resolve(strict=True)
    revision = git(root, "rev-parse", "HEAD").decode().strip()
    raw = git(root, "--no-pager", "log", "--no-show-signature", "--no-decorate", "-50", "--format=%H%x00%an%x00%cI%x00%s%x00", "HEAD", "--")
    if len(raw) > 256 * 1024:
        raise ValueError("Contribution metadata exceeds 256 KiB.")
    fields = raw.decode("utf-8").split("\0")
    commits = []
    for index in range(0, len(fields) - 1, 4):
        sha, author, committed_at, subject = fields[index:index + 4]
        clean = lambda value, limit: "".join(c for c in value if c.isprintable()).strip()[:limit]
        commits.append({"sha": sha.strip(), "author": clean(author, 120) or "Unknown author", "subject": clean(subject, 240) or "No subject", "committed_at": committed_at})
    if git(root, "rev-parse", "HEAD").decode().strip() != revision:
        raise ValueError("Repository changed during contribution capture.")
    return {"repository": root.name + " · " + hashlib.sha256(str(root).encode()).hexdigest()[:8], "revision": revision, "commits": commits}


def architecture_snapshot(root):
    """Read tracked package manifests only; never import code or run build scripts."""
    root = pathlib.Path(root).resolve(strict=True)
    revision = git(root, "rev-parse", "HEAD").decode().strip()
    if pathlib.Path(git(root, "rev-parse", "--show-toplevel").decode().strip()).resolve() != root:
        raise ValueError("Choose the repository root.")
    listing = git(root, "ls-files", "--stage", "-z")
    if len(listing) > 2 * 1024 * 1024:
        raise ValueError("Repository file inventory exceeds 2 MiB.")
    nodes, dependencies = [], {}
    for record in listing.split(b"\0"):
        if not record:
            continue
        meta, raw = record.split(b"\t", 1)
        path = raw.decode("utf-8")
        name = pathlib.PurePosixPath(path).name
        if name not in {"Cargo.toml", "package.json", "pyproject.toml"}:
            continue
        mode, _, stage = meta.split()
        candidate = root / path
        if stage != b"0" or mode not in {b"100644", b"100755"} or any(p.is_symlink() for p in [candidate, *candidate.parents] if p != root):
            raise ValueError("Resolve manifest conflicts or symlinks before inspecting architecture.")
        if not candidate.exists():
            continue
        if not candidate.resolve().is_relative_to(root):
            raise ValueError("Manifest path leaves the repository.")
        with candidate.open("rb") as stream:
            data = stream.read(65537)
        if len(data) > 65536:
            raise ValueError("Manifest exceeds 64 KiB.")
        if name != "package.json" and tomllib is None:
            raise ValueError("Architecture inspection needs Python 3.11+ or the tomli package.")
        document = json.loads(data) if name == "package.json" else tomllib.loads(data.decode())
        package = document.get("package", {}) if name == "Cargo.toml" else document.get("project", {}) if name == "pyproject.toml" else document
        label = package.get("name", pathlib.PurePosixPath(path).parent.name or root.name)
        if not isinstance(label, str) or not re.fullmatch(r"[A-Za-z0-9@._/-]{1,100}", label):
            label = name
        deps = document.get("dependencies", {})
        deps = deps if isinstance(deps, dict) else {}
        tech = [t for t in ["react", "vite", "next", "tauri", "axum", "sqlx", "tokio", "electron"] if t in deps]
        kind = {"Cargo.toml": "Rust manifest", "package.json": "JavaScript package", "pyproject.toml": "Python project"}[name]
        local = []
        for value in deps.values():
            relative = value.get("path") if isinstance(value, dict) else value[5:] if isinstance(value, str) and value.startswith("file:") else None
            if isinstance(relative, str) and not relative.startswith("/"):
                target = posixpath.normpath(posixpath.join(posixpath.dirname(path), relative, name))
                if not target.startswith("../"):
                    local.append(target)
        dependencies[path] = local[:32]
        nodes.append({"id": path, "name": label, "kind": kind, "technologies": tech,
                      "dependencies": [], "sha256": hashlib.sha256(data).hexdigest()})
        if len(nodes) > 64:
            raise ValueError("Architecture inventory exceeds 64 manifests.")
    ids = {n["id"] for n in nodes}
    for node in nodes:
        node["dependencies"] = sorted({d for d in dependencies[node["id"]] if d in ids})
    if git(root, "rev-parse", "HEAD").decode().strip() != revision:
        raise ValueError("Repository revision changed during inspection.")
    return {"repository": root.name + " · " + hashlib.sha256(str(root).encode()).hexdigest()[:8],
            "revision": revision, "dirty": bool(git(root, "status", "--porcelain", "--untracked-files=no")), "nodes": sorted(nodes, key=lambda n: n["id"])}


def bundle(files):
    bodies, sources = {}, []
    for source in files:
        key = hashlib.sha256(source["content"].encode()).hexdigest()
        bodies[key] = source["content"]
        sources.append({"path": source["path"], "body": key})
    result = {"schema_version": 1, "bodies": bodies, "sources": sources}
    # Exact reconstruction is the only quality claim of this local evaluator.
    assert [{"path": s["path"], "content": bodies[s["body"]]} for s in sources] == files
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class API:
    def __init__(self, url):
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path.rstrip("/") != "/api/v1"):
            raise ValueError("The context harness requires a local Relay API URL.")
        self.base = url.rstrip("/")
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path, data=None):
        request = urllib.request.Request(self.base + path,
                                         data=None if data is None else json.dumps(data).encode(),
                                         headers={"Content-Type": "application/json"})
        with self.opener.open(request, timeout=10) as response:
            return json.load(response)


def cycle(api, root):
    status = api.request("/autonomy")
    if status["control"]["paused"]:
        return "paused"
    scan = snapshot(root)
    # Read twice so normal concurrent file saves cannot publish a mixed inventory.
    if snapshot(root) != scan:
        return "repository changed; retrying"
    saved = api.request("/autonomy/scans", scan)
    if status.get("capabilities", {}).get("repository_architecture"):
        topology = architecture_snapshot(root)
        if architecture_snapshot(root) != topology:
            return "repository architecture changed; retrying"
        api.request("/architectures/repository", topology)
    if status.get("capabilities", {}).get("repository_contributions"):
        api.request("/contributions", contribution_snapshot(root))
    claimed = api.request("/autonomy/claims", {"scan_id": saved["id"]})
    job = claimed.get("job")
    if job:
        if (job["schema_version"] != 1 or job["kind"] != "lossless_context_pack_v1"
                or job["files"] != scan["files"] or job["scan_id"] != saved["id"]):
            raise ValueError("Harness task does not match the inspected repository snapshot.")
        candidate = bundle(job["files"])
        if snapshot(root) != scan:
            api.request("/autonomy/scans", snapshot(root))
            return "repository changed; evaluation withheld"
        api.request("/autonomy/proposals/" + urllib.parse.quote(job["id"], safe="") + "/result",
                    {"lease_token": job["lease_token"], "bundle": candidate})
        return "evaluation recorded"
    return "watching tracked instructions"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=pathlib.Path)
    parser.add_argument("--api", default="http://127.0.0.1:8178/api/v1")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    api = API(args.api)
    previous = None
    while True:
        try:
            state = cycle(api, args.repo)
        except (OSError, ValueError, subprocess.SubprocessError, urllib.error.URLError):
            state = "scan unavailable; check the local API, repository, and documented file limits"
            if args.once:
                raise
        if state != previous:
            print("Context harness: " + state, flush=True)
            previous = state
        if args.once:
            break
        time.sleep(15)


if __name__ == "__main__":
    main()
