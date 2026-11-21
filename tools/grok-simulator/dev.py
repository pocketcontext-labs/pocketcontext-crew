"""Launch a dedicated Crew dev instance and its local Grok simulator."""

import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser


ROOT = Path(__file__).resolve().parents[2]
CREW_PORT = 57990
RECEIVER_PORT = 57991
VITE_PORT = 57992
PARTICIPANTS = (("Local dispatcher", "external"), ("Local specialist", "bot"))


def check_ports():
    for port in (CREW_PORT, RECEIVER_PORT, VITE_PORT):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as error:
                raise RuntimeError(f"Port {port} is busy. Stop the previous rehearsal first.") from error


def wait_ready(child, url):
    for _ in range(180):
        if child.poll() is not None:
            raise RuntimeError(f"Service exited during startup ({child.returncode})")
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except (OSError, urllib.error.URLError):
            time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {url}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True,
                        help="New or existing simulator-only directory")
    parser.add_argument("--mode", choices=("scripted", "coding-agent"), default="scripted")
    parser.add_argument("--open", action="store_true", help="Open the simulator and sign into the local Crew reader")
    options = parser.parse_args()
    state = options.state.resolve()
    binary = ROOT / "bin/pocketcontext-crew"
    if not binary.is_file() or not (ROOT / "ui/node_modules/vite/bin/vite.js").is_file():
        parser.error("Build the Crew binary and install the ui dependencies in this checkout first.")
    node = shutil.which("node")
    if not node:
        parser.error("Node is required for the Vite development reader.")
    if options.mode == "coding-agent" and not shutil.which("codex"):
        parser.error("Coding-agent mode requires the codex CLI on PATH.")
    check_ports()
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    marker = state / ".crew-grok-rehearsal"
    if not marker.exists():
        if any(state.iterdir()):
            parser.error("--state must be empty or belong to this simulator.")
        marker.touch(mode=0o600, exist_ok=False)
    db = state / "project/pocketcontext.db"
    db.parent.mkdir(mode=0o700, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith("POCKETCONTEXT_")}

    def crew(*args, body=None):
        result = subprocess.run([str(binary), "--db", str(db), *args], input=body,
                                text=True, env=env, stdout=subprocess.PIPE, check=True)
        return json.loads(result.stdout)

    if not db.exists():
        crew("init", "--name", "Local Grok rehearsal", "--port", str(CREW_PORT),
             "--password-stdin", body=secrets.token_urlsafe(32) + "\n")
        crew("stop")
    children = []
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        dev_env = {**env, "POCKETCONTEXT_CREW_DEV_WEBHOOK_SIMULATOR": "1",
                   "VITE_CREW_GROK_SIMULATOR": "1"}
        api = subprocess.Popen([node, "scripts/dev.mjs", "--db", str(db),
                                "--vite-port", str(VITE_PORT)], cwd=ROOT, env=dev_env)
        children.append(api)
        wait_ready(api, f"http://127.0.0.1:{CREW_PORT}/api/bundle/instance")
        for name, kind in PARTICIPANTS:
            crew("write", "-", body=json.dumps({"action": "agent.ensure", "data": {"name": name, "kind": kind},
                                                "idempotency_key": f"simulator-provision-{kind}",
                                                "reported_agent": "Local simulator setup"}))
        runner = subprocess.Popen([sys.executable, str(Path(__file__).with_name("server.py")),
                                   "--db", str(db), "--binary", str(binary), "--mode", options.mode,
                                   "--state-dir", str(state / "runner")], env=env)
        children.append(runner)
        sim_url = f"http://127.0.0.1:{RECEIVER_PORT}/"
        wait_ready(runner, sim_url)
        print(f"Local chats: {sim_url}\nCrew setup: http://127.0.0.1:{CREW_PORT}/#/connect?section=integration",
              flush=True)
        if options.open:
            webbrowser.open(sim_url)
            webbrowser.open(crew("open", "--no-browser")["signInLink"])
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
        raise RuntimeError("A rehearsal service exited. See its output above.")
    except KeyboardInterrupt:
        pass
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=30)


if __name__ == "__main__":
    main()
