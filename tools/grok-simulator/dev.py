"""Launch a dedicated Crew dev instance and its local Grok simulator."""

import argparse
import json
import os
from pathlib import Path
import re
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


def check_ports(ports):
    for port in ports:
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


MOBILE_PORTS = (58000, 58001, 58002, 57993)
HOSTED_SETTINGS = ("OWNER_EMAIL", "SMTP_HOST", "SMTP_PORT", "SMTP_TLS", "SMTP_FROM",
                   "SMTP_USERNAME", "SMTP_PASSWORD")


def hostname(value):
    if len(value) > 253 or "." not in value or not all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
        for label in value.split(".")
    ) or value.replace(".", "").isdigit():
        raise argparse.ArgumentTypeError("Expected a bare lowercase DNS hostname")
    return value


def private_state(state, profile):
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state.stat().st_mode & 0o077:
        raise ValueError("--state must be a private directory (0700)")
    marker = state / ".crew-grok-rehearsal"
    if marker.is_file():
        if marker.read_text() != profile:
            raise ValueError("This state directory belongs to another rehearsal profile")
    else:
        if any(state.iterdir()):
            raise ValueError("--state must be empty or belong to this simulator")
        with marker.open("x") as out:
            out.write(profile)


def launch_hosted(options, state, binary, node, env, children):
    crew_port, receiver_port, vite_port, gateway_port = MOBILE_PORTS
    assert options.public_domain and options.sim_host
    origin = "https://" + options.public_domain
    sim_origin = "https://" + options.sim_host
    db = state / "project/pocketcontext.db"
    db.parent.mkdir(mode=0o700, exist_ok=True)
    project_env = dict(env)
    for key, dirname in (("HOME", "home"), ("XDG_CACHE_HOME", "cache"),
                         ("XDG_CONFIG_HOME", "config"), ("XDG_STATE_HOME", "state")):
        directory = state / dirname
        directory.mkdir(mode=0o700, exist_ok=True)
        project_env[key] = str(directory)
    backend_env = {**project_env, "POCKETCONTEXT_CREW_DEV_WEBHOOK_SIMULATOR": "hosted-rehearsal"}
    for key in HOSTED_SETTINGS:
        value = os.environ.get("POCKETCONTEXT_" + key)
        if value:
            backend_env["POCKETCONTEXT_" + key] = value
        elif key != "SMTP_TLS":
            raise ValueError(f"Set POCKETCONTEXT_{key} for the development mail service")
    def start(command, environment, cwd=ROOT):
        child = subprocess.Popen(command, cwd=cwd, env=environment)
        children.append(child)
        return child

    vite_url = f"http://127.0.0.1:{vite_port}"
    vite = start([node, "node_modules/vite/bin/vite.js", "--port", str(vite_port), "--strictPort"],
                 {**env, "POCKETCONTEXT_DEV_PUBLIC_DOMAIN": options.public_domain,
                  "VITE_CREW_GROK_SIMULATOR": "1"}, ROOT / "ui")
    wait_ready(vite, vite_url)
    serve = [str(binary), "--db", str(db), "serve", "--headless", "--mcp",
             "--hosted", "--domain", options.public_domain, "--public-ui-dev",
             "--ui-dev", vite_url, "--dev-http-address", f"127.0.0.1:{crew_port}"]
    if not db.exists():
        serve.append("--hosted-init")
    backend = start(serve, backend_env)
    wait_ready(backend, f"http://127.0.0.1:{crew_port}/up")
    for name, kind in PARTICIPANTS:
        subprocess.run([str(binary), "--db", str(db), "write", "-"], cwd=ROOT,
                       env=project_env, text=True, stdout=subprocess.PIPE, check=True,
                       input=json.dumps({"action": "agent.ensure", "data": {"name": name, "kind": kind},
                                         "idempotency_key": f"simulator-provision-{kind}",
                                         "reported_agent": "Mobile rehearsal setup"}))
    # Crew first writes its portable database on flush. The simulator binds
    # its saved chats to that file before it accepts any requests.
    subprocess.run([str(binary), "--db", str(db), "flush"], env=project_env,
                   check=True, stdout=subprocess.PIPE)
    runner_env = {**project_env, "CREW_SIMULATOR_CREW_ORIGIN": origin,
                  "CREW_SIMULATOR_RECEIVER_URL": f"http://127.0.0.1:{receiver_port}/webhook",
                  "CODEX_HOME": env.get("CODEX_HOME", str(Path.home() / ".codex"))}
    runner = start([sys.executable, str(Path(__file__).with_name("server.py")),
                    "--db", str(db), "--binary", str(binary), "--mode", options.mode,
                    "--port", str(receiver_port), "--state-dir", str(state / "runner")], runner_env)
    wait_ready(runner, f"http://127.0.0.1:{receiver_port}/")
    gateway = start([sys.executable, str(Path(__file__).with_name("gateway.py")), "--crew-host",
                     options.public_domain, "--sim-host", options.sim_host, "--owner-email",
                     backend_env["POCKETCONTEXT_OWNER_EMAIL"], "--port", str(gateway_port)], env)
    for _ in range(100):
        if gateway.poll() is not None:
            raise RuntimeError("Gateway exited during startup")
        try:
            with socket.create_connection(("127.0.0.1", gateway_port), timeout=1):
                break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError("Timed out waiting for the mobile gateway")
    print(f"Crew: {origin}/\nChats: {sim_origin}/\nGateway upstream: 127.0.0.1:{gateway_port}", flush=True)
    if options.open:
        webbrowser.open(origin)
        webbrowser.open(sim_origin)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True,
                        help="New or existing simulator-only directory")
    parser.add_argument("--mode", choices=("scripted", "coding-agent"), default="scripted")
    parser.add_argument("--open", action="store_true", help="Open the simulator and sign into the local Crew reader")
    parser.add_argument("--binary", type=Path, default=ROOT / "bin/pocketcontext-crew", help="Crew executable from this checkout")
    parser.add_argument("--public-domain", type=hostname, help="Hosted rehearsal Crew HTTPS hostname")
    parser.add_argument("--sim-host", type=hostname, help="Hosted rehearsal simulator HTTPS hostname")
    options = parser.parse_args()
    if bool(options.public_domain) != bool(options.sim_host) or (options.public_domain and options.public_domain == options.sim_host):
        parser.error("Provide two distinct hostnames with --public-domain and --sim-host")
    os.umask(0o077)
    state = options.state.resolve()
    binary = options.binary.resolve()
    if not binary.is_file() or not (ROOT / "ui/node_modules/vite/bin/vite.js").is_file():
        parser.error("Build the Crew binary and install the ui dependencies in this checkout first.")
    node = shutil.which("node")
    if not node:
        parser.error("Node is required for the Vite development reader.")
    if options.mode == "coding-agent" and not shutil.which("codex"):
        parser.error("Coding-agent mode requires the codex CLI on PATH.")
    hosted = bool(options.public_domain)
    check_ports(MOBILE_PORTS if hosted else (CREW_PORT, RECEIVER_PORT, VITE_PORT))
    private_state(state, json.dumps([options.public_domain, options.sim_host]) if hosted else "")
    db = state / "project/pocketcontext.db"
    db.parent.mkdir(mode=0o700, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith("POCKETCONTEXT_")}

    def crew(*args, body=None):
        result = subprocess.run([str(binary), "--db", str(db), *args], input=body,
                                text=True, env=env, stdout=subprocess.PIPE, check=True)
        return json.loads(result.stdout)

    if not hosted and not db.exists():
        crew("init", "--name", "Local Grok rehearsal", "--port", str(CREW_PORT),
             "--password-stdin", body=secrets.token_urlsafe(32) + "\n")
        crew("stop")
    children = []
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        if hosted:
            launch_hosted(options, state, binary, node, env, children)
        else:
            dev_env = {**env, "POCKETCONTEXT_CREW_DEV_WEBHOOK_SIMULATOR": "1",
                       "VITE_CREW_GROK_SIMULATOR": "1"}
            api = subprocess.Popen([node, "scripts/dev.mjs", "--binary", str(binary), "--db", str(db),
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
