---
name: crew-grok-simulator
description: Launch and exercise the local PocketContext Crew Grok simulator. Use it to rehearse the six dispatcher setup steps with a local dispatcher and specialist, inspect webhook acknowledgments and task execution, or compare scripted workers with separate Codex sessions.
---

Run from the pocketcontext-crew source checkout containing `tools/grok-simulator/dev.py`. Use a dedicated simulator data directory. Reuse it to keep the same Crew instance, chats and credentials. Choose a new empty directory for a rehearsal that starts at step one.

## Launch

Build the development binary with the current hooks (`make build` after building the UI) and install the reader dependencies as described in the repository README. For scripted workers, run:

```sh
uv run --project tools/grok-simulator tools/grok-simulator/dev.py --state .private/grok-rehearsal --mode scripted --open
```

Use `--mode coding-agent` with a signed-in Codex CLI to run model-backed turns in separate dispatcher and specialist sessions. You can also switch modes in the simulator when both chats are idle. Coding-agent turns use model quota. Use scripted mode for unattended repeatable tests. The two modes use the same Crew wizard and local transport.

Keep the launcher running. It creates a local development instance on port 57990, a simulator on 57991 and a Vite reader on 57992. Ctrl-C stops the rehearsal. Restart with the same state directory to resume. The launcher prints the URLs. To sign back into the local reader, use `bin/pocketcontext-crew --db .private/grok-rehearsal/project/pocketcontext.db open`.

## Rehearse the wizard

1. In Crew, open **Connect an agent → Set up automatic wake-ups**. Choose **Local dispatcher** and select the **parent conversation** dispatch path. Open **Agents** and copy each participant's **Start in a chat** prompt into its own simulator chat.
2. Under **Prepare Grok**, copy the setup prompt into the dispatcher chat. After it reports the mappings and instruction sync, expand **Can't use a group?** and paste the bot authorization prompt separately into both chats.
3. Copy the receiver URL and secret directly from the simulator controls to **Enter webhook credentials** in Crew. Keep credentials out of chat.
4. Under **Verify the connection**, select **Local specialist** and send one test. Look for routine acknowledgment, parent receipt, native send and automatic specialist acknowledgment in Crew. A successful HTTP delivery alone is insufficient.
5. Choose **Enable future notifications** after the diagnostic passes. Existing Ready tasks stay quiet.
6. Paste **Verify task routing**'s routing prompt into the dispatcher chat. Inspect the two synthetic tasks, their comments and completed executions. One is self-work, the other is a handoff. Use the two chat transcripts to follow who actually received and performed each action.

If a turn fails, inspect the relevant chat and Crew's execution history before sending another event. Let the owner decide whether to recover an uncertain real execution. These calls exercise the local simulator and Crew; live Grok behavior needs separate verification.
