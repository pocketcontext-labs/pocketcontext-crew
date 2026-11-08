# Local development

Use a dedicated development Crew instance containing synthetic notes. Keep it
outside a synced or production project. The source checkout and development
project are separate: Go compiles the application; the application owns its
working database, snapshots and private machine cache.

## Toolchain with devenv

On Linux or macOS, install [Nix and devenv](https://devenv.sh/getting-started/),
then run from the repository root:

```sh
devenv shell
pc-dev-build
```

`devenv.nix`, `devenv.yaml` and `devenv.lock` provide Go 1.27.3 with CGO and a C
compiler, Node.js 24, pnpm 10.33.2, Make, Python, Git, curl, jq, Caddy and
cloudflared. `pc-dev-build` runs `make ui` and `make build`; the frontend install
uses the frozen lockfile. The first shell entry downloads Nix packages. It does
not install an agent adapter, authenticate to a provider, create a database or
start services. `devenv up` is not configured; use the commands below.

Keep the lockfile with the configuration. Update inputs deliberately with
`devenv update`, check the resulting tool versions and rerun the build. The Go
version assertion prevents a nixpkgs update from silently changing the required
toolchain. Native Windows development uses the tools listed in the README and
MinGW-w64 for CGO; this Nix shell is not the Windows setup path.

For optional direnv activation, merge this into the Git-ignored `.envrc`, preserving
any existing local settings and keeping private values in `.envrc.private`:

```sh
# -*- mode: sh; -*-
eval "$(devenv direnvrc)"
use devenv
source_env_if_exists .envrc.private
```

Review the file, then run `direnv allow`. Give `.envrc.private` mode `600`.
Never import private environment files from Nix expressions: their contents must
not enter the Nix store. `devenv shell` itself does not source `.envrc.private`.
See [devenv's direnv integration](https://devenv.sh/integrations/direnv/).

## Initialize once, then start hot reload

Inside the development shell, choose an absolute path for a new development
project. The following path is deliberately inside Git-ignored `.private/`:

```sh
mkdir -p .private/dev/project
chmod 700 .private .private/dev .private/dev/project
DEV_DB="$PWD/.private/dev/project/pocketcontext.db"
bin/pocketcontext-crew init --db "$DEV_DB" --name "PocketContext Development" --port 18096
bin/pocketcontext-crew stop --db "$DEV_DB"
pc-dev --db "$DEV_DB"
```

`init` asks for the development account password and starts a headless server;
`stop` flushes and stops it before the foreground development launcher starts.
Do not repeat initialization to start an existing project. On subsequent runs:

```sh
devenv shell
pc-dev --db "$PWD/.private/dev/project/pocketcontext.db"
```

Without devenv, the equivalent launcher is
`node scripts/dev.mjs --db /absolute/path/to/dev/pocketcontext.db` or
`make dev DB=/absolute/path/to/dev/pocketcontext.db`.

The launcher checks the database and ports, starts Vite on `127.0.0.1:5173`,
then starts PocketContext on the project's configured port, with Vite as its
loopback UI upstream. Open **http://127.0.0.1:18096**, not port 5173, and sign in.
For a fresh sign-in link, run this in another terminal with access to the project:

```sh
bin/pocketcontext-crew open --db "$PWD/.private/dev/project/pocketcontext.db" --no-browser
```

A link expires after two minutes. On a remote host, the host's loopback URL is
not reachable from your desktop without forwarding. For private desktop access,
forward the project port over SSH:

```sh
ssh -N -L 18096:127.0.0.1:18096 USER@DEV_HOST
```

Press Ctrl-C in the launcher terminal to stop both processes and flush the
application's database normally. The launcher refuses occupied ports rather than
stopping another process. `--vite-port PORT` selects another Vite port; changing
the project reader port is a separate project configuration change.

Edits to `ui/src` hot reload. Go code, hooks and migrations require stopping the
server, rebuilding with `make build`, and restarting it. Before testing the
embedded/release reader, rebuild both UI and binary. Hot reload does not
perform TypeScript checks.

## Public development with MCP and HTTPS hot reload

Use this explicit mode on a separate development instance when an external agent
needs MCP and a browser needs hot reload at the same HTTPS origin. It does not
change production serving defaults. The public reader still requires owner email
login and MCP still requires OAuth consent.

Prepare the isolated hosted project first. For an authorized production snapshot,
use the verified restore procedure, revoke copied sessions/MCP grants, rotate the
webhook epoch, and disable production webhook bindings before exposing the copy.
Never put private backups or runtime state beneath `ui/`. Automated tests continue
to use synthetic temporary projects, not the development copy. The launcher does
not initialize or restore a database and never reads a private environment file.

Supply development hosted settings through the trusted parent environment or a
private service `EnvironmentFile`: the owner email and SMTP variables documented
in [hosting](hosting.md), and separate `XDG_CACHE_HOME`, `XDG_CONFIG_HOME` and
`XDG_STATE_HOME` paths for the development runtime. Use development SMTP settings;
do not inherit production backup scheduling or credentials. The backend inherits
the environment; PocketContext runtime bindings are removed from Vite's environment.
The launcher runs the binary directly, not the hosted backup supervisor.

With Caddy terminating HTTPS on the same machine:

```sh
node scripts/dev.mjs \
  --db /absolute/private/crew-development/project/pocketcontext.db \
  --binary /absolute/source/pocketcontext-crew/bin/pocketcontext-crew \
  --public-domain walter.bigconfig.space \
  --dev-http-address 127.0.0.1:18098 \
  --vite-port 5174
```

This starts the backend with `--headless --hosted --mcp --public-ui-dev`, the
explicit domain, private HTTP address and loopback Vite upstream. Vite remains
bound to loopback; its browser WebSocket uses
`wss://walter.bigconfig.space/__ui_hmr` on port 443. The private HTTP address defaults
to `127.0.0.1:18098` and the launcher accepts only that loopback IPv4 host with an
unprivileged port. The ordinary local reader TCP listener is not enabled in this
mode. Readiness checks use the local control path to verify the exact child PID
and configured MCP origin; the public route never exposes local instance metadata.

Caddy's site configuration is:

```caddyfile
walter.bigconfig.space {
    reverse_proxy 127.0.0.1:18098
}
```

Only Caddy listens publicly on ports 80/443. It must proxy WebSocket upgrades as
well as HTTP. Crew checks the configured HTTPS Host/Origin and routes only the
explicit development assets and `/__ui_hmr` to Vite. Local administration and the
PocketBase dashboard stay excluded. Do not route `/api` or `/mcp` through Vite,
disable authentication, or globally permit arbitrary Hosts/Origins. Development
source modules are served as UI assets; API authentication does not make source
files confidential. Keep all secrets outside the Vite filesystem allowlist.

Connect the external client to `https://walter.bigconfig.space/mcp` and grant fresh
OAuth consent for this development instance. A stable domain allows ordinary
backend restarts without replacing the MCP address. The launcher reports backend
readiness, not DNS/certificate/firewall reachability; verify the public site
separately. After public-mode startup, a Vite failure leaves MCP and the backend
running; UI requests return an unavailable response until Vite restarts. The
launcher retries Vite with exponential backoff from 500ms to a maximum of 10s,
resetting after a frontend has stayed alive for 30s. An explicit launcher stop or
backend exit cancels retries and stops both owned processes. Ordinary local mode
keeps its existing stop-both behavior when either child exits. API and MCP routing
never falls through to Vite.

The MCP adapter accepts the configured public hostname even when Caddy reaches
Crew over loopback. Crew enforces its exact public Host/Origin boundary and OAuth
before entering the protocol handler; this replaces the SDK's generic localhost
hostname heuristic only for that guarded adapter. It does not allow arbitrary
hostnames or anonymous MCP access.

For a temporary tunnel, configure the explicit HTTPS hostname the same way and
forward it to the private hosted HTTP listener. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
change hostname on restart and do not support Server-Sent Events; each new hostname
requires matching server configuration and OAuth reconnection. Vite hot reload
uses WebSockets. A stable Caddy hostname is preferable for repeated development.

## Validation

After reader edits:

```sh
pnpm --dir ui typecheck
pnpm --dir ui test
pnpm --dir ui build
```

After launcher changes, run `node --test tests/dev_launcher.test.mjs`. For real
browser checks, install the pinned browser once with
`pnpm --dir ui exec playwright install chromium`, then run
`node tests/ui_dev_browser.mjs --binary bin/pocketcontext-crew` and the reader/browser
checks in the README. Native browser system dependencies are separate from the
Nix toolchain; the scripts also accept an explicitly supplied browser executable.

Before shipping application changes, rebuild and run the Go, name and end-to-end
checks in the README. Tests must use temporary projects and synthetic data, never
the running development or production database.
