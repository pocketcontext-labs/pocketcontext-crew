"""Local two-chat simulator. Run with --help for launch options."""
import argparse
from collections import deque
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from pathlib import Path
from queue import Full, Queue
import secrets
import shutil
import subprocess
from threading import Lock, Thread
from uuid import UUID



ROOT = Path(__file__).resolve().parent
ROLES = ("dispatcher", "specialist")


def private_write(path, text):
    temp = path.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as out:
        os.chmod(temp, 0o600)
        out.write(text)
    temp.replace(path)


class Codex:
    def __init__(self, directory, participants):
        self.directory = directory
        self.participants = participants
        self.executable = shutil.which("codex")
        if not self.executable:
            raise ValueError("coding-agent mode requires an authenticated Codex CLI on PATH")

    def __call__(self, role, prompt):
        directory = self.directory / role
        directory.mkdir(mode=0o700, exist_ok=True)
        session = directory / "session-id"
        command = [
            self.executable, "exec", "--ignore-user-config", "--sandbox", "read-only",
            "--disable", "shell_tool", "--disable", "unified_exec",
            "--disable", "apps", "--disable", "plugins",
        ]
        if session.exists():
            command.extend(["resume", str(UUID(session.read_text().strip()))])
        command.extend(["--skip-git-repo-check", "--json", "-"])
        result = subprocess.run(
            command, cwd=directory, input=(
                f"You are {self.participants[role]}, the {role} in a local Crew simulator. "
                "Respond in this chat. The simulator performs allowed local Crew operations. "
                "Do not invoke shell commands or access files, networks, credentials, or other Crew instances.\n\n"
                + prompt
            ), text=True, capture_output=True, timeout=180, check=False,
        )
        messages = []
        for line in result.stdout.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") == "thread.started":
                thread_id = str(UUID(event["thread_id"]))
                if session.exists() and session.read_text().strip() != thread_id:
                    raise RuntimeError("Codex returned a different session ID on resume")
                private_write(session, thread_id)
            item = event.get("item") or {}
            if event.get("type") == "item.completed" and item.get("type") == "agent_message":
                messages.append(item["text"])
        if result.returncode or not messages or not session.exists():
            raise RuntimeError("Codex turn failed. Check CLI login and model availability.")
        return "\n".join(messages)


class Simulator:
    def __init__(self, args, directory):
        from crew_sim_protocol import Protocol

        self.mode = args.mode
        self.names = dict(zip(ROLES, (args.dispatcher, args.specialist)))
        self.directory = directory
        self.lock = Lock()
        self.secret_file = directory / "webhook-secret"
        if not self.secret_file.exists():
            private_write(self.secret_file, secrets.token_urlsafe(32))
        self.secret = self.secret_file.read_text().strip()
        self.transcript = {role: deque(maxlen=300) for role in ROLES}
        self.transcript_file = directory / "transcript.jsonl"
        if self.transcript_file.exists():
            with self.transcript_file.open() as lines:
                for line in lines:
                    entry = json.loads(line)
                    self.transcript[entry["role"]].append(entry)
        self.pending = 0
        self.queue = Queue(maxsize=128)
        self.protocol = Protocol(args.binary, args.db, args.dispatcher, args.specialist,
                                 model=Codex(directory, self.names) if self.mode == "coding-agent" else None,
                                 state_dir=directory)
        Thread(target=self.process, daemon=True).start()

    def record(self, role, text, source="agent"):
        entry = dict(role=role, text=str(text).replace(self.secret, "[redacted]"), source=source,
                     time=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        with self.lock:
            with self.transcript_file.open("a", encoding="utf-8") as out:
                out.write(json.dumps(entry, ensure_ascii=False) + "\n")
            self.transcript[role].append(entry)

    def enqueue(self, kind, role, payload):
        with self.lock:
            self.queue.put_nowait((kind, role, payload))
            self.pending += 1

    def set_mode(self, mode):
        if mode not in ("scripted", "coding-agent"):
            raise ValueError("Choose Scripted or Coding agent.")
        with self.lock:
            if self.pending:
                return False
            if mode != self.mode:
                self.protocol.model = Codex(self.directory, self.names) if mode == "coding-agent" else None
                self.mode = mode
            return True

    def send(self, role, payload):
        if role not in ROLES:
            raise ValueError("Unknown recipient")
        self.enqueue("message", role, payload)

    def process(self):
        while True:
            kind, role, payload = self.queue.get()
            try:
                if kind == "wake":
                    self.record(role, "Crew webhook received.", "webhook")
                    self.protocol.handle_wake(payload, self.send, self.record)
                elif kind == "message":
                    self.record(role, "Local bot message received.", "message")
                    self.protocol.handle_message(role, payload, self.send, self.record)
                else:
                    self.record(role, payload, "owner")
                    self.protocol.handle_chat(role, payload, self.send, self.record)
            except Exception as error:
                self.record(role, str(error).replace(self.secret, "[redacted]")[:1500], "error")
            finally:
                with self.lock:
                    self.pending -= 1
                self.queue.task_done()

    def state(self, origin):
        with self.lock:
            return dict(mode=self.mode, busy=bool(self.pending), participants=self.names,
                        credentials=dict(url=origin + "/webhook", secret=self.secret),
                        chats={role: list(entries) for role, entries in self.transcript.items()})


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, simulator, **kwargs):
        self.simulator = simulator
        super().__init__(*args, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def respond(self, status, body=b"", mime="application/json"):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(body)

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server.server_port}"

    def allowed(self):
        return (self.headers.get("Host") == self.origin.removeprefix("http://")
                and self.headers.get("Origin", self.origin) == self.origin
                and self.headers.get("Sec-Fetch-Site", "none") in ("same-origin", "none"))

    def do_GET(self):
        if not self.allowed():
            return self.respond(403)
        if self.path == "/api/state":
            return self.respond(200, self.simulator.state(self.origin))
        assets = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript"),
                  "/style.css": ("style.css", "text/css"), "/favicon.ico": (None, "image/x-icon")}
        if self.path not in assets:
            return self.respond(404)
        name, mime = assets[self.path]
        self.respond(200, (ROOT / name).read_bytes() if name else b"", mime)

    def do_POST(self):
        if not self.allowed():
            return self.respond(403)
        if self.path == "/webhook":
            supplied = self.headers.get("Authorization", "").encode()
            if not hmac.compare_digest(supplied, ("Bearer " + self.simulator.secret).encode()):
                return self.respond(401)
        elif self.path in ("/api/chat", "/api/mode"):
            if self.headers.get("Origin") != self.origin:
                return self.respond(403)
        else:
            return self.respond(404)
        if self.headers.get_content_type() != "application/json":
            return self.respond(415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 32768:
                return self.respond(413)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                return self.respond(400)
            if self.simulator.secret in json.dumps(payload):
                return self.respond(400, {"error": "Keep webhook credentials in setup only."})
            if self.path == "/api/mode":
                try:
                    switched = self.simulator.set_mode(payload.get("mode"))
                except ValueError as error:
                    return self.respond(400, {"error": str(error)})
                if not switched:
                    return self.respond(409, {"error": "Wait for pending chat and webhook events to finish."})
                return self.respond(200, {"mode": payload["mode"]})
            if self.path == "/webhook":
                self.simulator.enqueue("wake", "dispatcher", payload)
            else:
                role = payload.get("role")
                text = payload.get("text")
                if role not in ROLES or not isinstance(text, str) or not text.strip():
                    return self.respond(400)
                self.simulator.enqueue("chat", role, text.strip())
        except (ValueError, UnicodeError):
            return self.respond(400)
        except Full:
            return self.respond(HTTPStatus.SERVICE_UNAVAILABLE)
        self.respond(202, {"queued": True})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--state-dir", type=Path, help="private simulator data (default: next to the synthetic database)")
    parser.add_argument("--mode", choices=["scripted", "coding-agent"], default="scripted")
    parser.add_argument("--port", type=int, default=57991)
    parser.add_argument("--dispatcher", default="Local dispatcher")
    parser.add_argument("--specialist", default="Local specialist")
    args = parser.parse_args()
    os.umask(0o077)
    db = Path(args.db).resolve()
    if (db.name != "pocketcontext.db" or db.parent.name != "project"
            or not (db.parent.parent / ".crew-grok-rehearsal").is_file()):
        parser.error("Use the dedicated rehearsal database created by dev.py")
    args.db = str(db)
    binary = shutil.which(args.binary)
    if not binary or not db.exists():
        parser.error("Provide an executable Crew binary and an existing synthetic database")
    args.binary = str(Path(binary).resolve())
    directory = (args.state_dir or db.parent / (db.name + ".grok-simulator")).resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_mode & 0o077:
        parser.error("Simulator state directory must be private (mode 0700)")
    sim = Simulator(args, directory)
    with ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, simulator=sim)) as server:
        print(f"Grok simulator ({args.mode}): http://127.0.0.1:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
