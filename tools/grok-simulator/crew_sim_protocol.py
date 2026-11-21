"""Local simulator participants using Crew's public work-client commands."""
import json
from pathlib import Path
import subprocess

LABEL = "grok-simulator"
ROLES = ("dispatcher", "specialist")
REFS = {role: f"local-simulator-{role}" for role in ROLES}


class Protocol:
    def __init__(self, binary, db, dispatcher, specialist, *, state_dir, model=None):
        if dispatcher == specialist:
            raise ValueError("Choose two distinct agents")
        self.binary = str(Path(binary).resolve(strict=True))
        self.db = str(Path(db).resolve(strict=True))
        config = json.loads(Path(db).with_name("pocketcontext.json").read_text(encoding="utf-8"))
        self.origin = f"http://127.0.0.1:{config.get('port') or 8099}"
        self.names = dict(zip(ROLES, (dispatcher, specialist)))
        self.model = model
        self.file = Path(state_dir) / "routine.json"
        self.file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        binding = {"database": self.db, "instance": config["instance"], "names": self.names}
        self.state = {"binding": binding, "joined": {}, "authorized": {}}
        if self.file.exists():
            self.state = json.loads(self.file.read_text(encoding="utf-8"))
            if self.state["binding"] != binding:
                raise ValueError("This simulator state belongs to a different Crew database or team")

    def _save(self):
        temp = self.file.with_suffix(".tmp")
        temp.write_text(json.dumps(self.state), encoding="utf-8")
        temp.chmod(0o600)
        temp.replace(self.file)

    def _call(self, command, body):
        result = subprocess.run(
            [self.binary, command, "--db", self.db, "-"], input=json.dumps(body),
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode:
            raise RuntimeError(f"Crew {body.get('action', command)}: {result.stderr.strip()[:500]}")
        return json.loads(result.stdout)

    def _read(self, collection, **filters):
        return self._call("read", {"collection": collection, **filters})

    def _rows(self, collection, **filters):
        rows = []
        offset = 0
        while True:
            page = self._read(collection, **filters, offset=offset)
            rows.extend(page["items"])
            if not page["has_more"]:
                return rows
            offset = page["next_offset"]

    def _record(self, collection, id):
        rows = self._rows(collection, id=id)
        if len(rows) != 1:
            raise ValueError(f"Cannot find {collection} record {id}")
        return rows[0]

    def _config(self):
        rows = [r for r in self._rows("webhook_configs") if r.get("scope") == "global"]
        if len(rows) != 1:
            raise ValueError("Expected one global integration")
        return rows[0]

    def _write(self, role, action, data, *, record=None, event=None, proof=None, **extra):
        body = {"action": action, "reported_agent": self.names[role], "data": data, **extra}
        if record is not None:
            body.update(id=record["id"], expected_revision=record["revision"])
        if proof:
            body["execution"] = proof
        if event:
            body["idempotency_key"] = f"sim:{event}:{role}:{action}"
        return self._call("write", body)

    def _id(self, role):
        id = self.state["joined"].get(role)
        if not id:
            raise ValueError(f"Paste Start in a chat into the {role} chat first")
        return id

    def _authorized(self, role):
        if self.state["authorized"].get(role) != self._id(role):
            raise ValueError(f"Paste the owner authorization into the {role} chat")

    def _reply(self, role, text, log):
        if self.model:
            log(role, self.model(role, text))

    def handle_chat(self, role, text, send, log):
        """Only direct owner chat enters here. Queued bot messages cannot grant authorization."""
        text = text.strip()
        if text.startswith("You are "):
            session = self._read("session", agent=self.names[role])
            if text != session["prompt"].strip():
                raise ValueError(f"Use the current Start in a chat prompt for {self.names[role]}")
            self.state["joined"][role] = session["agent"]["id"]
            self._save()
            log(role, f"Joined as {self.names[role]}. Session revision {session['revision']}.")
            self._reply(role, f"{text}\nYour Crew session instructions:\n{session['instructions']}", log)
            return
        self._id(role)
        if text.startswith(("I authorize this bot to use my Crew instance at ",
                            "I authorize every bot in this group chat to use my Crew instance at ")):
            target = text.split("instance at ", 1)[1].split()[0]
            if target != self.origin:
                raise ValueError("Use authorization for the local Crew instance")
            self.state["authorized"][role] = self._id(role)
            self._save()
            log(role, "Owner authorized this participant for diagnostics and assigned simulation tasks.")
        elif text.startswith("Set up this existing Grok Bot as the Crew dispatcher") and role == "dispatcher":
            self._setup(log)
        elif text.startswith("Verify Crew routing with two clearly labeled synthetic tasks") and role == "dispatcher":
            self._samples(log)
        elif self.model:
            self._reply(role, text, log)
            return
        else:
            raise ValueError("Paste the matching session, setup, individual authorization or routing prompt from Crew.")
        self._reply(role, "The local adapter handled this owner request. Briefly acknowledge:\n" + text, log)

    def _setup(self, log):
        self._read("capabilities")
        config = self._config()
        if config.get("agent") != self._id("dispatcher"):
            raise ValueError(f"Choose {self.names['dispatcher']} in Crew setup step 1")
        mappings = {r["agent"]: r for r in self._rows("webhook_mappings")}
        for role in ROLES:
            id = self._id(role)
            mapping = mappings.get(id, {})
            if mapping.get("bot_ref") not in (None, "", REFS[role]):
                raise ValueError(f"{self.names[role]} already has a different mapping")
        for role in ROLES:
            id = self._id(role)
            mapping = mappings.get(id, {})
            if mapping.get("bot_ref") != REFS[role]:
                self._write("dispatcher", "webhook.mapping.update", {
                    "agent": id, "bot_ref": REFS[role], "bot_name": self.names[role],
                }, expected_revision=mapping.get("revision", 0))
        config = self._config()
        self.state["instructions"] = config["instructions"]
        self._save()
        saved = json.loads(self.file.read_text(encoding="utf-8"))["instructions"]
        self._write("dispatcher", "webhook.instructions.sync", {
            "instruction_revision": config["instruction_revision"], "status": "verified",
            "routine_ref": "local-simulator-routine", "instructions": saved,
        }, record=config)
        log("dispatcher", f"Mapped both participants. Verified routine revision {config['instruction_revision']}.")

    def _samples(self, log):
        if not self._config()["enabled"]:
            raise ValueError("Enable delivery in Crew before verifying task routing")
        existing = self._rows("tasks", label=LABEL)
        for role in ROLES:
            self._authorized(role)
        for role in ROLES:
            title = f"Local simulator routing test: {self.names[role]}"
            assigned = self._id(role)
            task = next((r for r in existing if r["title"] == title and r["assigned_agent"] == assigned), None)
            if task is None:
                task = self._write("dispatcher", "task.create", {
                    "assigned_agent": assigned, "title": title, "labels": [LABEL], "readiness": "ready",
                    "description": "Synthetic routing check. Reply pong once and complete the task.",
                })
            log("dispatcher", f"Routing sample for {role}: {task['id']}")

    def _recipient(self, wake):
        if wake["dispatcher_agent_id"] != self._id("dispatcher"):
            raise ValueError("Wake is for another dispatcher")
        for role, ref in REFS.items():
            if wake["recipient_bot_ref"] == ref and wake["recipient_agent_id"] == self._id(role):
                return role
        raise ValueError("Unknown local recipient")

    def handle_wake(self, payload, send, log):
        wake = payload
        self._recipient(wake)
        self._authorized("dispatcher")
        config = self._config()
        if config["id"] != wake["config_id"]:
            raise ValueError("Wake is for another integration")
        event = wake["event_id"]
        log("dispatcher", f"Routine received {wake['event_type']} {event}")
        bridge = wake["dispatch_mode"] == "parent_bridge"
        if wake["event_type"] == "webhook.test":
            if config.get("runtime_event_id") != event:
                self._write("dispatcher", "webhook.runtime.report", {
                    "event_id": event, "context": "webhook", "native_handoff": not bridge,
                    "parent_wake": bridge, "execution_protocol": True,
                }, record=config, event=event)
            self._write("dispatcher", "execution.test_ack", {
                "event_id": event, "epoch": wake["epoch"],
            }, event=event)
            log("dispatcher", "Routine acknowledged the diagnostic.")
        elif wake["event_type"] == "task.wake":
            if LABEL not in self._record("tasks", wake["task_id"]).get("labels", []):
                log("dispatcher", f"Ignored task without the {LABEL} label.")
                return
        else:
            raise ValueError("Unsupported webhook event")
        if bridge:
            b = self._write("dispatcher", "webhook.bridge.prepare", {
                "event_id": event, "epoch": wake["epoch"], "worker_id": "local-routine",
            }, event=event)
            if b["next_step"] == "wake_parent":
                send("dispatcher", {"kind": "parent", "bridge": b["id"], "wake": wake})
            else:
                log("dispatcher", f"{b['next_step']}: no second parent wake.")
        elif wake["event_type"] == "task.wake":
            self._execute("dispatcher", wake, send, log)
        else:
            log("dispatcher", "Native connection diagnostic complete.")

    def handle_message(self, role, msg, send, log):
        self._authorized(role)
        wake, kind = msg["wake"], msg["kind"]
        recipient = self._recipient(wake)
        event = wake["event_id"]
        if kind == "task" and role == recipient:
            self._execute(role, wake, send, log)
            return
        b = self._record("webhook_bridges", msg["bridge"])
        if kind == "test" and role == recipient:
            self._write(role, "webhook.bridge.ack", {
                "automatic": True, "recipient_agent_id": self._id(role),
            }, record=b, event=event)
            log(role, f"Automatically acknowledged diagnostic {event}.")
            return
        if kind != "parent" or role != "dispatcher":
            raise ValueError("Message was delivered to the wrong participant")
        b = self._write(role, "webhook.bridge.parent", {
            "native_handoff": True, "execution_protocol": True,
        }, record=b, event=event)
        step = b["next_step"]
        log(role, f"Dispatcher received parent wake: {step}.")
        if step == "dispatch_task":
            self._execute(role, wake, send, log)
        elif step == "send_test":
            send(recipient, {"kind": "test", "bridge": b["id"], "wake": wake})
            self._write(role, "webhook.bridge.sent", {"sent": True}, record=b, event=event)

    def _execute(self, role, wake, send, log):
        event = wake["event_id"]
        run = self._write(role, "execution.begin", {
            "event_id": event, "epoch": wake["epoch"], "generation": wake["wake_generation"],
            "worker_id": REFS[role], "role": "dispatcher" if role == "dispatcher" else "recipient",
            "native_handoff": role == "dispatcher", "lease_seconds": 900,
        }, event=event)
        step = run["next_step"]
        log(role, f"Execution {run['id']}: {step}.")
        if step == "handoff":
            recipient = self._recipient(wake)
            send(recipient, {"kind": "task", "wake": wake})
            self._write(role, "execution.dispatched", {
                "worker_id": REFS[role], "fence": run["fence"], "sent": True,
            }, record=run, event=event)
            return
        if step not in {"work", "self_work"}:
            return
        ctx, task = run["agent_context"], run["task_context"]
        if ctx["agent_id"] != self._id(role) or LABEL not in task.get("labels", []):
            raise ValueError("Acquired an unexpected task or recipient")
        log(role, f"Loaded workflow revision {ctx['revision']} for {ctx['name']}.\n{ctx['workflow']}")
        proof = run["execution"]
        completion = {"worker_id": proof["worker_id"], "fence": proof["fence"]}
        comment = "pong"
        if self.model:
            try:
                comment = self.model(role,
                    f"Your local adapter acquired this synthetic task. It will post your answer and complete it. "
                    f"Write only your answer, at most 20000 characters. To decline, start with STOP: and say why."
                    f"\n{ctx['execution_guidance']}\nBrief: {ctx['brief']}\n"
                    f"Instructions: {ctx['workflow']}\nTask: {task['title']}\n{task.get('description', '')}").strip()
                if not comment or len(comment) > 20000:
                    raise ValueError("Coding agent returned an empty or oversized comment")
                if comment.startswith("STOP:"):
                    raise ValueError(comment)
            except Exception:
                self._write(role, "execution.complete", {**completion, "outcome": "failed"},
                            record=run, event=event)
                raise
        task = self._write(role, "task.comment", {"body": comment}, record=task, proof=proof, event=event)
        self._write(role, "execution.complete", {
            **completion, "outcome": "completed", "mark_done": True, "task_revision": task["revision"],
        }, record=run, event=event)
        log(role, f"Completed {task['id']} using workflow revision {ctx['revision']}.\n{comment}")
