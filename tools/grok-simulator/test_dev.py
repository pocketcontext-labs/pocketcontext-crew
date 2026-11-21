import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import dev


class HostedLauncherTests(unittest.TestCase):
    def test_profile_cannot_reuse_local_or_other_hosts_state(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root)
            dev.private_state(state, "")
            with self.assertRaisesRegex(ValueError, "another rehearsal"):
                dev.private_state(state, '["crew.example.test","sim.example.test"]')

    def test_hosted_children_and_resume(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root)
            options = SimpleNamespace(public_domain="crew.example.test", sim_host="sim.example.test",
                                      mode="scripted", open=False)
            mail = {"POCKETCONTEXT_" + key: "synthetic" for key in dev.HOSTED_SETTINGS}
            child = MagicMock()
            child.poll.return_value = None
            with patch.dict(os.environ, mail), patch.object(dev, "wait_ready"), \
                    patch.object(dev.subprocess, "Popen", return_value=child) as spawn, \
                    patch.object(dev.subprocess, "run") as run, patch.object(dev.socket, "create_connection"):
                for first in (True, False):
                    dev.launch_hosted(options, state, Path("/test/crew"), "node", {}, [])
                    vite, backend, runner, gateway = spawn.call_args_list[-4:]
                    self.assertEqual("--hosted-init" in backend.args[0], first)
                    self.assertIn("127.0.0.1:58000", backend.args[0])
                    self.assertEqual(backend.kwargs["env"]["POCKETCONTEXT_SMTP_PASSWORD"], "synthetic")
                    for call in (vite, runner, gateway, *run.call_args_list):
                        self.assertNotIn("POCKETCONTEXT_SMTP_PASSWORD", call.kwargs["env"])
                    self.assertEqual(runner.kwargs["env"]["HOME"], str(state / "home"))
                    self.assertEqual(runner.kwargs["env"]["CREW_SIMULATOR_RECEIVER_URL"],
                                     "http://127.0.0.1:58001/webhook")
                    provision = run.call_args_list[-3:-1]
                    self.assertEqual([json.loads(call.kwargs["input"])["data"]["name"] for call in provision],
                                     ["Local dispatcher", "Local specialist"])
                    self.assertEqual(run.call_args_list[-1].args[0][-1], "flush")
                    (state / "project/pocketcontext.db").touch()


if __name__ == "__main__":
    unittest.main()
