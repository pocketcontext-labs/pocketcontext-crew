"""Exercise the simulator's local authorization and its Crew execution boundary."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock

from crew_sim_protocol import Protocol, REFS


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name)
        db = self.path / "pocketcontext.db"
        db.touch()
        db.with_name("pocketcontext.json").write_text(json.dumps({"port": 8123, "instance": "one"}))
        self.sim = Protocol(__file__, db, "First", "Second", state_dir=self.path)
        self.sim.state["joined"] = {"dispatcher": "d", "specialist": "s"}
        self.send, self.log = Mock(), Mock()
        self.event = {
            "event_id": "first-event", "epoch": "epoch", "wake_generation": 2,
            "event_type": "task.wake", "task_id": "t", "config_id": "c",
            "recipient_agent_id": "s", "dispatcher_agent_id": "d",
            "recipient_bot_ref": REFS["specialist"], "dispatch_mode": "parent_bridge",
        }
        self.sim._config = Mock(return_value={"id": "c", "enabled": True})
        self.sim._record = Mock(return_value={"id": "t", "revision": 1, "labels": ["grok-simulator"]})
        self.sim._write = Mock()

    def test_authorization_belongs_to_one_local_participant_and_instance(self):
        for target in ["http://127.0.0.1:8273", "https://crew.example.com", "http://user@127.0.0.1:8123"]:
            with self.assertRaisesRegex(ValueError, "rehearsal Crew instance"):
                self.sim.handle_chat("dispatcher", f"I authorize this bot to use my Crew instance at {target}",
                                     self.send, self.log)
        self.sim.handle_chat("dispatcher", "I authorize this bot to use my Crew instance at http://127.0.0.1:8123",
                             self.send, self.log)
        self.assertEqual(self.sim.state["authorized"], {"dispatcher": "d"})
        with self.assertRaisesRegex(ValueError, "specialist chat"):
            self.sim.handle_message("specialist", {"kind": "task", "wake": self.event}, self.send, self.log)
        self.sim._write.assert_not_called()

    def test_hosted_authorization_is_bound_to_exact_rehearsal_mcp_endpoint(self):
        for model in (None, Mock(return_value="Joined")):
            sim = Protocol(__file__, self.path / "pocketcontext.db", "First", "Second",
                           state_dir=self.path, model=model, crew_origin="https://crew-dev.example.com")
            sim.state["joined"] = {"dispatcher": "d", "specialist": "s"}
            prefix = "I authorize this bot to use my Crew instance at "
            for target in ("https://crew-dev.example.com", "https://prod.example.com/mcp",
                           "https://crew-dev.example.com/mcp/extra", self.sim.origin):
                with self.assertRaisesRegex(ValueError, "rehearsal Crew instance"):
                    sim.handle_chat("dispatcher", prefix + target, self.send, self.log)
            sim.handle_chat("dispatcher", prefix + "https://crew-dev.example.com/mcp through our shared MCP connection",
                            self.send, self.log)
            self.assertEqual(sim.state["authorized"], {"dispatcher": "d"})

    def test_unrelated_task_is_never_acknowledged_or_acquired(self):
        self.sim.state["authorized"] = self.sim.state["joined"].copy()
        self.sim._record.return_value["labels"] = []
        self.sim.handle_wake(self.event, self.send, self.log)
        self.sim._write.assert_not_called()
        self.send.assert_not_called()

    def test_replay_cannot_wake_parent_again(self):
        self.sim.state["authorized"] = self.sim.state["joined"].copy()
        self.sim._write.side_effect = [{"id": "b", "next_step": "wake_parent"},
                                       {"id": "b", "next_step": "reconcile"}]
        for _ in range(2):
            self.sim.handle_wake(self.event, self.send, self.log)
        calls = self.sim._write.call_args_list
        self.assertEqual(calls[0], calls[1])
        self.send.assert_called_once_with("dispatcher", {"kind": "parent", "bridge": "b", "wake": self.event})

    def test_model_consumes_current_instructions_and_worker_output_is_fenced(self):
        self.sim.state["authorized"] = self.sim.state["joined"].copy()
        self.sim.model = Mock(return_value="pong from the specialist")
        proof = {"id": "execution", "worker_id": REFS["specialist"], "fence": 2}
        run = {
            "id": "execution", "revision": 3, "fence": 2, "next_step": "work", "execution": proof,
            "agent_context": {"agent_id": "s", "name": "Second", "brief": "Test brief",
                              "workflow": "Updated workflow", "revision": 7, "execution_guidance": "Use fence"},
            "task_context": {"id": "t", "revision": 1, "title": "Synthetic task", "labels": ["grok-simulator"]},
        }
        self.sim._write.side_effect = [run, run["task_context"], {}]
        self.sim.handle_message("specialist", {"kind": "task", "wake": self.event}, self.send, self.log)
        self.assertIn("Updated workflow", self.sim.model.call_args.args[1])
        begin, comment, complete = self.sim._write.call_args_list
        self.assertEqual(begin.args[2]["role"], "recipient")
        self.assertEqual(comment.args[2], {"body": "pong from the specialist"})
        self.assertEqual(comment.kwargs["proof"], proof)
        self.assertEqual(complete.args[2]["fence"], 2)
        self.send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
