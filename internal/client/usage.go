package client

// Usage is the help text.
const Usage = `pocketcontext — PocketContext Crew server, administration and agent commands

The project is the database file (default: pocketcontext.db beside this binary, or
--db PATH, or POCKETCONTEXT_DB), the storage/ folder and pocketcontext.json beside
it. They may live in iCloud Drive, OneDrive, Dropbox or Google Drive.

Setup and server:
  init [--name NAME] [--port N] [--password-stdin]
                       create the Crew project and its account, and start the server
  ensure-running       start the server in the background unless it runs (alias: start)
  serve [--headless | --tcp-only] [--domain HOST] [--acme-email EMAIL] [--mcp]
        [--tunnel] [--hosted [--hosted-init | --hosted-restore]]
        [--port N] [--ui-dev URL]
                       run in the foreground; plain serve enables socket and TCP
                       --headless --tunnel owns both server and tunnel in one process
                       --headless --domain HOST enables HTTPS on 443, HTTP redirects
                       and ACME challenges on 80; certificates renew automatically
                       --hosted uses HTTP on 80 behind an HTTPS proxy with email login
                       and public MCP only; explicit --hosted-init creates a new instance
  stop                 write back the database and stop the server
  status               show paths, port, lease and whether the server runs
  environment          report session/browser signals offline (no project needed)
  open [--public | --no-browser | --skip-reader]
                       --public prints a phone sign-in link from the running HTTPS
                       service without opening a browser; local command only
                       otherwise open in a confirmed desktop session or skip
                       --no-browser requests a link for a known reachable browser
                       --skip-reader issues no link and enables no reader TCP
  password [--password-stdin]
                       change the reader password
  login-code [--ttl SECONDS]
                       print a one-time sign-in code (single use, kept in
                       server memory only, default 600 seconds, 30-600) for
                       ` + "`login --url URL --code-stdin`" + `
  flush                write the database back to the synced folder now
  recover --keep local|synced
                       resolve unsaved changes when the synced file also changed
  skill [--agent claude-code|codex|antigravity|all] [--dir DIR]
                       register this Crew instance, install its skill and the global router
  name [NAME]          show or change the Crew instance name
  profile add|update|list|remove|default|check|repair [NAME]
                       manage private registrations; never delete project data
  manual --out NEW_DIR  export the embedded user manual offline

Instance:
  whoami               show the signed-in Crew instance, name and version

Crew work (agents; the routes of the MCP tools, with the same JSON input;
JSON|- takes one object as an argument or from standard input):
  read JSON|-          filtered, projected reads (crew_read)
  search JSON|-        ranked full-text search over notes and tasks (crew_search)
  schema               read-only SQL views and limits (crew_schema)
  query JSON|-         one bounded read-only SQL statement (crew_query)
  write JSON|-         revision-checked agent writes and review requests
                       (crew_write); owner decisions, bucket archival and
                       agent deactivation are refused
  They work locally (--db) and through a paired computer (--url). Without a
  domain they act with the owner's sign-in; the agent route still applies.
  Use the reader for owner decisions. All Crew records are instance-wide.

Tunnel (carry the server's port to another computer):
  tunnel serve [--new-address]
                       start a headless server if needed; expose its service;
                       keep tunnel supervised in the foreground;
                       Ctrl-C stops the tunnel, leaving the server running
  tunnel invite [--out FILE]
                       print one complete client setup prompt to share in chat;
                       --out optionally writes invitation JSON outside the project
  tunnel join (--stdin | --file FILE) [--no-browser | --skip-reader] [--foreground]
                       verify identity, sign in, save a managed background forward
                       and open the reader when usable; --skip-reader skips it,
                       --no-browser requests a link for a reachable browser
  tunnel forward [--background | --address-stdin --save] [--url URL]
                       reuse a saved connection or provide an address through stdin;
                       --background manages a saved forward without this terminal
  tunnel status|stop --url URL
                       inspect or stop this client's managed forward

Remote client (the server runs on another computer, reached through
` + "`tunnel forward`" + ` or an SSH forward of the same port; --url URL or POCKETCONTEXT_URL):
  login --url URL --code-stdin
                       sign in with a one-time code from ` + "`login-code`" + ` on the
                       agent computer, read from standard input; stores only
                       a token in the private cache
  login --url URL [--password-stdin]
                       sign in with the project password instead
  logout --url URL     forget the stored session
  status --url URL     show whether the server answers and the sign-in
  open --url URL [--no-browser | --skip-reader]
                       use the signed-in client session for the reader;
                       skip by default on SSH/headless/unknown sessions
  skill --url URL [--agent A] [--dir DIR]
                       install the agent skill for the remote server
  read|search|schema|query|write --url URL [JSON|-]
                       Crew work through the signed-in session
  URL must be http://127.0.0.1:PORT or
  http://localhost:PORT. Remote mode never creates a database or starts a
  server; serve, start, ensure-running, stop, flush, recover, init, password
  and login-code are not available with --url.

Run ` + "`pocketcontext help COMMAND`" + ` or ` + "`pocketcontext COMMAND --help`" + ` for usage, details and an example.
Options for every command: --db PATH or --url URL, --pretty.
--url and --db exclude each other; --db overrides POCKETCONTEXT_URL.
Exit codes: 0 ok, 1 HTTP or transport error (including 403 owner-only refusals
and 429 rate limits, which name the seconds to wait), 2 usage or invalid input,
3 check differences, 4 HTTP 409: either a revision conflict (reread, reassess,
retry) or a Crew refusal with a reason code such as handoff_limited (do not
retry unchanged); the last stderr line says which.
`
