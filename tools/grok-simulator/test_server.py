"""Offline regression tests for the simulator receiver and coding-agent adapter."""
import json
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Thread
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from server import Codex, Handler, Simulator


class FakeProtocol:
    def __init__(self, *args, **kwargs):
        pass

    def handle_wake(self, payload, send, log):
        send("specialist", {"task": payload["task"]})

    def handle_message(self, role, message, send, log):
        log(role, "Received " + message["task"])

    def handle_chat(self, role, text, send, log):
        log(role, "Reply to " + text)


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        args = SimpleNamespace(mode="scripted", dispatcher="Local dispatcher",
                               specialist="Local specialist", binary="/unused", db="/unused")
        with patch.dict("sys.modules", crew_sim_protocol=SimpleNamespace(Protocol=FakeProtocol)):
            self.sim = Simulator(args, self.directory)
            self.assertEqual(self.sim.secret, Simulator(args, self.directory).secret)
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, simulator=self.sim))
        Thread(target=self.http.serve_forever, daemon=True).start()
        self.addCleanup(self.http.server_close)
        self.addCleanup(self.http.shutdown)
        self.origin = "http://127.0.0.1:" + str(self.http.server_port)

    def request(self, method, path, data=None, **headers):
        client = HTTPConnection("127.0.0.1", self.http.server_port, timeout=2)
        try:
            client.request(method, path, body=json.dumps(data) if data is not None else None,
                           headers={"Content-Type": "application/json", **headers})
            response = client.getresponse()
            return response.status, response.read()
        finally:
            client.close()

    def test_authenticated_wake_owner_chat_and_cross_origin(self):
        payload = {"task": "Synthetic"}
        self.assertEqual(self.request("POST", "/webhook", payload)[0], 401)
        self.assertEqual(self.request("GET", "/api/state", Host="foreign.example")[0], 403)
        self.assertEqual(self.request("GET", "/api/state", Origin="https://foreign.example")[0], 403)
        self.assertEqual(self.request("GET", "/api/state", **{"Sec-Fetch-Site":"cross-site"})[0], 403)
        chat = {"role": "dispatcher", "text": "Hello"}
        self.assertEqual(self.request("POST", "/api/chat", chat)[0], 403)
        self.assertEqual(self.request("POST", "/api/chat", {**chat, "text":self.sim.secret}, Origin=self.origin)[0], 400)
        self.assertEqual(self.request("POST", "/api/chat", chat, Origin=self.origin)[0], 202)
        self.assertEqual(self.request("POST", "/webhook", payload, Authorization="Bearer " + self.sim.secret)[0], 202)
        self.sim.queue.join()
        state = json.loads(self.request("GET", "/api/state")[1])
        self.assertEqual(state["credentials"]["url"], self.origin + "/webhook")
        self.assertEqual(state["chats"]["dispatcher"][0]["text"], "Hello")
        self.assertEqual(state["chats"]["specialist"][-1]["text"], "Received Synthetic")
        self.assertNotIn(self.sim.secret, self.sim.transcript_file.read_text())

    def test_mode_changes_only_when_idle_and_keeps_receiver_and_participants(self):
        entering, release = Event(), Event()

        def slow_chat(*args):
            entering.set()
            release.wait(timeout=5)

        def switch(mode):
            return self.request("POST", "/api/mode", {"mode": mode}, Origin=self.origin)[0]

        protocol = self.sim.protocol
        secret = self.sim.secret
        with patch.object(protocol, "handle_chat", side_effect=slow_chat):
            self.sim.enqueue("chat", "dispatcher", "First")
            self.assertTrue(entering.wait(timeout=2))
            self.sim.enqueue("chat", "specialist", "Second")
            try:
                self.assertEqual(switch("coding-agent"), 409)
                self.assertTrue(self.sim.state(self.origin)["busy"])
            finally:
                release.set()
                self.sim.queue.join()
        with patch("server.Codex") as adapter:
            self.assertEqual(self.request("POST", "/api/mode", {"mode": "coding-agent"})[0], 403)
            self.assertEqual(switch("coding-agent"), 200)
            adapter.return_value.assert_not_called()
            self.assertIs(self.sim.protocol, protocol)
            self.assertIs(self.sim.protocol.model, adapter.return_value)
            self.assertEqual(self.sim.state(self.origin)["mode"], "coding-agent")
            self.assertEqual(switch("scripted"), 200)
            self.assertIsNone(self.sim.protocol.model)
            self.assertEqual(self.sim.secret, secret)
            self.assertEqual(self.sim.state(self.origin)["chats"]["dispatcher"][0]["text"], "First")
            self.assertEqual(switch("unknown"), 400)


class CodingTests(unittest.TestCase):
    def test_each_role_starts_and_resumes_its_own_session(self):
        with TemporaryDirectory() as temp:
            directory = Path(temp)
            ids = {role: str(uuid4()) for role in ("dispatcher", "specialist")}
            calls = []
            def cli(command, *, cwd, input, **kwargs):
                role = cwd.name
                calls.append((role, command))
                self.assertIn("--ignore-user-config", command)
                self.assertIn("read-only", command)
                self.assertIn("shell_tool", command)
                self.assertEqual(cwd.parent, directory)
                self.assertIn(role, input)
                events = [{"type":"thread.started", "thread_id":ids[role]},
                          {"type":"item.completed", "item":{"type":"agent_message", "text":"pong"}}]
                return SimpleNamespace(returncode=0, stdout="\n".join(map(json.dumps, events)))
            with patch("server.shutil.which", return_value="/mock/codex"), patch("server.subprocess.run", side_effect=cli):
                for _ in range(2):
                    adapter = Codex(directory, {"dispatcher":"One", "specialist":"Two"})
                    for role in ids:
                        self.assertEqual(adapter(role, "Ping"), "pong")
            self.assertFalse(any("resume" in command for _, command in calls[:2]))
            for role, command in calls[2:]:
                self.assertEqual(command[command.index("resume") + 1], ids[role])


if __name__ == "__main__":
    unittest.main()
