package client

import (
	"fmt"
	"strings"
)

// helpEntry is the text of `help COMMAND` and `COMMAND --help`.
type helpEntry struct{ usage, text, example string }

// commandHelp has one entry for every command in the dispatch table of run
// and for the commands handled before it (help and version).
var commandHelp = map[string]helpEntry{
	"environment": {"environment [--pretty]", "Report session and browser capability signals without opening a database, starting a server or browser or issuing credentials. SSH takes precedence over display signals; unknown is not a confirmed desktop. No environment values are exposed.", "pocketcontext environment --pretty"},
	"manual":      {"manual --out NEW_DIRECTORY", "Export the embedded versioned user manual and hash manifest without a server. Refuses an existing directory.", "pocketcontext manual --out manual-0.18.0"},
	"name":        {"name [NAME]", "Show or change the project name. Stable project identity stays unchanged; reconcile profiles explicitly after renaming.", "pocketcontext name Research"},
	"profile":     {"profile add|update|list|remove|default|check|repair [NAME] [--binary PATH] [--skill-dir DIR]", "Manage private named Crew instance registrations. add/update accept --db or --url. Removing a profile never deletes data. check verifies identity, name, binary and running server versions, and skill before use; repair reinstalls the router.", "pocketcontext profile list"},
	"help": {"help [COMMAND]",
		"Print the command overview, or the usage, description and an example of one command. `COMMAND --help` does the same.",
		"pocketcontext help serve"},
	"version": {"version", "Print the version and commit of this binary.", "pocketcontext version"},

	"init": {"init [--name NAME] [--port N] [--password-stdin]",
		"Create the project (database, storage/ and pocketcontext.json) and its one account, then start the server. The account has no email to choose: the reader asks only for its password. An existing account keeps its password unless --password-stdin is given.",
		"printf '%s\\n' \"$PASSWORD\" | pocketcontext init --password-stdin"},
	"ensure-running": {"ensure-running [--take-over]",
		"Start the server in the background unless it already runs for this database (alias: start). --take-over ignores a lease from another computer; use it only when that computer is off.",
		"pocketcontext ensure-running"},
	"start": {"start [--take-over]", "Alias of ensure-running.", "pocketcontext start"},
	"serve": {"serve [--headless | --tcp-only] [--domain HOST] [--acme-email EMAIL] [--mcp] [--tunnel] [--hosted [--hosted-init | --hosted-restore]] [--port N] [--take-over] [--ui-dev URL]", "Run the server in the foreground until interrupted. --hosted requires --headless --domain HOST --mcp, serves HTTP on port 80 behind an HTTPS proxy and uses email-only login configured by POCKETCONTEXT_OWNER_EMAIL and POCKETCONTEXT_SMTP_* environment variables. It excludes tunnels, ACME and local TCP. --hosted-init explicitly creates a new hosted account/database and refuses an existing database. --hosted-restore invalidates copied browser, email and MCP credentials before serving a deliberately restored backup. Ordinary hosted startup preserves sessions and refuses a missing database. --headless --domain HOST enables native HTTPS on 443 and HTTP challenge/redirects on 80 with automatic Let’s Encrypt certificates. Use a bare lowercase DNS hostname pointing to this host; --acme-email optionally sets the ACME contact. The domain and email are service arguments, never synced settings. HTTPS can run with or without --tunnel. --mcp explicitly enables the authenticated remote MCP endpoint and OAuth account linking on this HTTPS domain. --headless --tunnel owns the initialized project server and private tunnel in one process, refusing an already running server. Supervise this command as one service: interruption or stop closes the tunnel and flushes/stops the database; either component failure exits nonzero. --tunnel requires --headless. --ui-dev http://127.0.0.1:5173 serves the reader through a loopback Vite development server; APIs and sign-in remain on this server. Start Vite separately or use the repository development launcher. This option is foreground-only and is not saved in project configuration.", "pocketcontext serve"},
	"stop":  {"stop", "Write the database back to the synced folder and stop the server. Run it before switching computers or replacing the binary; see the exported manual docs/upgrades.md.", "pocketcontext stop"},
	"status": {"status",
		"Show paths, port, lease, write-back conflicts and whether the server runs. With --url: whether the server answers and who is signed in.",
		"pocketcontext status"},
	"open": {"open [--public | --no-browser | --skip-reader]",
		"With --public, print a two-minute HTTPS sign-in link from an already running hosting service, including over SSH; never launch a browser or start a background server. --public is local-only and cannot combine with --skip-reader. Otherwise open the reader only when this session has a confirmed desktop/browser. SSH, headless and unknown sessions skip without enabling TCP or issuing a code. --skip-reader explicitly skips; --no-browser explicitly prints a two-minute link only when the caller has verified browser reachability. --no-browser and --skip-reader are mutually exclusive. Remote --url uses the signed-in CLI session. browserLaunchRequested reports launcher dispatch, never verified browser opening.",
		"pocketcontext open --no-browser"},
	"flush": {"flush", "Write the database back to the synced folder now.", "pocketcontext flush"},
	"recover": {"recover --keep local|synced",
		"Resolve unsaved local changes when the synced database also changed elsewhere: keep this computer's copy or the synced one. The other copy is kept beside it.",
		"pocketcontext recover --keep synced"},
	"password": {"password [--password-stdin]", "Change the reader password of the project's account.", "pocketcontext password"},
	"login-code": {"login-code [--ttl SECONDS]",
		"Print a one-time sign-in code (single use, kept in server memory only, default 600 seconds, 30-600) for `login --url URL --code-stdin` on another computer.",
		"pocketcontext login-code"},
	"skill": {"skill [--agent claude-code|codex|antigravity|all] [--dir DIR]",
		"Install the agent skill with this computer's binary path and database (or, with --url, the remote server). Agents whose configuration folder is missing are skipped.",
		"pocketcontext skill --agent claude-code"},
	"login": {"login --url URL [--code-stdin | --password-stdin]",
		"Sign in to a forwarded server, with a one-time code from `login-code` read from standard input, or with the project password. Only a token is stored, in the private cache.",
		"printf '%s\\n' \"$CODE\" | pocketcontext login --url http://127.0.0.1:8096 --code-stdin"},
	"logout": {"logout --url URL", "Forget the stored session for that server.", "pocketcontext logout --url http://127.0.0.1:8096"},
	"tunnel": {"tunnel serve [--new-address] | tunnel invite [--out FILE] | tunnel join (--stdin | --file FILE) [--no-browser | --skip-reader] [--foreground] | tunnel forward [--background | --address-stdin --save] [--url URL] | tunnel status|stop --url URL",
		"Run a single-service tunnel. For one supervised process owning both server and tunnel, use serve --headless --tunnel. tunnel serve starts a headless background server if needed for an initialized project, or reuses a compatible server with its listeners unchanged. The tunnel stays in the foreground; interruption or tunnel failure leaves the server running (use stop to flush and stop it). Supervise tunnel serve on the server, then tunnel invite prints one complete client setup prompt to share in your setup chat; --out FILE optionally writes invitation JSON instead. tunnel join --stdin (or --file FILE) verifies the server, redeems its single-use ten-minute code, saves the connection, starts a managed background forward and opens the signed-in reader only in a usable desktop session. SSH/headless/unknown sessions pair without a reader code. --skip-reader explicitly skips reader setup; --no-browser explicitly requests a sign-in link for a verified reachable browser (mutually exclusive); --foreground keeps the forward attached to this terminal. tunnel forward --url URL --background resumes a saved connection; tunnel status/stop --url URL inspect or stop only its managed forward. Without --background, forward stays in the foreground. Invitations, codes and reader links may be shared in your setup chats; passwords, tokens and private identity keys must not be displayed. The address remains usable after code expiry; rotate only for unintended disclosure. Clients never use a database or local key. A busy port is refused.",
		"pocketcontext tunnel invite --db pocketcontext.db"},

	"whoami": {"whoami", "Show the authenticated Crew instance URL, name and version.", "pocketcontext whoami"},
}

// printHelp prints the help of one command, or the overview for "".
func printHelp(command string) error {
	if command == "" {
		fmt.Print(Usage)
		return nil
	}
	h, ok := commandHelp[command]
	if !ok {
		return fail(2, "unknown command %q; run `pocketcontext help`", command)
	}
	fmt.Printf("usage: pocketcontext %s\n\n%s\n\nExample:\n  %s\n", h.usage, wrap(h.text, 78), h.example)
	if command != "help" && command != "version" {
		fmt.Println("\nOptions for every command: --db PATH or --url URL, --pretty.")
	}
	return nil
}

// wrap folds each one-line paragraph at width; indented blocks stay as written.
func wrap(text string, width int) string {
	paragraphs := strings.Split(text, "\n\n")
	for i, p := range paragraphs {
		if strings.HasPrefix(p, " ") || strings.Contains(p, "\n") {
			continue
		}
		var lines []string
		line := ""
		for _, word := range strings.Fields(p) {
			if line != "" && len(line)+1+len(word) > width {
				lines, line = append(lines, line), ""
			}
			if line != "" {
				line += " "
			}
			line += word
		}
		paragraphs[i] = strings.Join(append(lines, line), "\n")
	}
	return strings.Join(paragraphs, "\n\n")
}

// wantsHelp reports whether the arguments ask for help (before any "--").
func wantsHelp(argv []string) bool {
	for _, arg := range argv {
		if arg == "--" {
			return false
		}
		if arg == "--help" || arg == "-h" {
			return true
		}
	}
	return false
}

// helpTopic returns the command named after `help`, skipping global options.
func helpTopic(rest []string) (string, error) {
	a, err := parseArgs(rest, nil, nil)
	if err != nil {
		return "", err
	}
	if len(a.pos) > 1 {
		return "", fail(2, "usage: pocketcontext help [COMMAND]")
	}
	if len(a.pos) == 0 {
		return "", nil
	}
	return strings.TrimSpace(a.pos[0]), nil
}
