# Use Crew without a domain

Crew also runs as one binary on your own computer, without a domain, HTTPS or
MCP. The binary is both the localhost server and the command-line client that
your coding agent calls through the installed skill. Other computers reach it
through the private tailcat tunnel. This is the same arrangement as
PocketContext; only the work commands differ.

## Set up on this computer

Choose a new project folder, for example in a synced drive. Download the
release's `install.sh` (Linux, macOS) or `install.ps1` (Windows) and
`checksums.txt`, verify and inspect the installer, and run it with that folder
(`sh install.sh FOLDER`; on Windows set `$env:CREW_INSTALL_DIR`); it installs `pocketcontext-crew` (`pocketcontext-crew.exe` on Windows) there.
Then initialize the project, sign in to the reader and install the agent skill:

```sh
cd /absolute/path/Crew
./pocketcontext-crew init --name Crew
./pocketcontext-crew open
./pocketcontext-crew skill
```

`init` asks for the owner password and starts the server in the background.
`skill` registers the instance in the private profile registry and installs its
skill and the global router for Claude Code, Codex and Antigravity (`--agent`
selects one). `profile list` and `profile check NAME` show the registration.
The server starts on demand when a command needs it; `stop` writes the database
back and stops it before you switch computers or upgrade.

## What agents run

The skill tells the agent to call the absolute binary with `--db`:

```sh
/absolute/path/Crew/pocketcontext-crew read --db /absolute/path/Crew/pocketcontext.db '{"collection":"capabilities"}'
```

The commands `read`, `search`, `schema`, `query` and `write` take the same JSON
as the MCP tools crew_read, crew_search, crew_schema, crew_query and crew_write
and call the same routes; `write` uses only the agent route. See
[the contract](crew.md#command-line-work-commands) and `help COMMAND`.

On an install without a domain, CLI agents act with owner authority: the local
key on this computer, or the saved session token on a paired computer. The
agent route still refuses owner decisions, bucket archival and agent
deactivation, but an agent holding owner credentials could reach owner routes;
the human-review boundary is enforced only for OAuth MCP clients. Decide reviews
yourself in the reader.

## Other computers

Keep the tunnel running on this computer and invite another computer:

```sh
./pocketcontext-crew tunnel serve
./pocketcontext-crew tunnel invite
```

`tunnel invite` prints one setup prompt; paste it into the agent on the other
computer. It installs the client, joins with a managed background forward,
signs in and runs `skill --url URL`, so that computer's agent uses the same
commands with `--url`. Supervise `tunnel serve` (or `serve --headless --tunnel`)
as a service if it should survive restarts; see [service](service.md).

## Limits

- Cloud assistants (Grok, Gemini web and mobile, ChatGPT and similar) cannot
  reach an install without a domain. They need public HTTPS MCP; see
  [MCP](mcp.md) and the [native guide](native-install.md).
- Outgoing webhook wakes can be configured, but a woken cloud bot cannot answer
  without public MCP; see [webhooks](webhooks.md).
- A paired computer keeps working through the tunnel address and its saved
  session. To remove one, rotate the address with
  `tunnel serve --new-address` and invite the computers you keep again.
