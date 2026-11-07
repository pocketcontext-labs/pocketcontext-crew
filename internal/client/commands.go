package client

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/term"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/bundle"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/profiles"
)

// args is a small argparse-like parser: flags may appear anywhere.
type args struct {
	pos   []string
	flags map[string]string
	bools map[string]bool
}

// parseArgs accepts the given value flags and boolean flags (without dashes).
func parseArgs(argv []string, values, booleans []string) (*args, error) {
	a := &args{flags: map[string]string{}, bools: map[string]bool{}}
	isValue, isBool := map[string]bool{}, map[string]bool{}
	for _, v := range append(values, "db", "url") {
		isValue[v] = true
	}
	for _, b := range append(booleans, "pretty") {
		isBool[b] = true
	}
	for i := 0; i < len(argv); i++ {
		arg := argv[i]
		if arg == "--" {
			a.pos = append(a.pos, argv[i+1:]...)
			break
		}
		if !strings.HasPrefix(arg, "--") || arg == "-" {
			a.pos = append(a.pos, arg)
			continue
		}
		name, value, hasValue := strings.Cut(arg[2:], "=")
		switch {
		case isBool[name] && !hasValue:
			a.bools[name] = true
		case isValue[name]:
			if !hasValue {
				if i+1 >= len(argv) {
					return nil, fail(2, "--%s needs a value", name)
				}
				i++
				value = argv[i]
			}
			a.flags[name] = value
		default:
			return nil, fail(2, "unknown option --%s", name)
		}
	}
	return a, nil
}

func (a *args) has(name string) bool { _, ok := a.flags[name]; return ok }

func (a *args) need(n int, usage string) error {
	if len(a.pos) != n {
		return fail(2, "usage: pocketcontext %s", usage)
	}
	return nil
}

func (a *args) intFlag(name string, fallback int) (int, error) {
	v, ok := a.flags[name]
	if !ok {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fail(2, "--%s must be a whole number", name)
	}
	return n, nil
}

func readPassword(fromStdin bool, confirm bool) (string, error) {
	if fromStdin {
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", err
		}
		return strings.TrimRight(line, "\r\n"), nil
	}
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		return "", fail(2, "no terminal to ask for a password; pass --password-stdin and write the password to standard input")
	}
	fmt.Fprint(os.Stderr, "Password (at least 8 characters): ")
	first, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	if confirm {
		fmt.Fprint(os.Stderr, "Repeat the password: ")
		second, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", err
		}
		if string(first) != string(second) {
			return "", fail(2, "the passwords differ")
		}
	}
	return string(first), nil
}

// Run executes one command and returns the process exit code.
func Run(argv []string) int {
	return commandResult(run(argv), os.Stderr)
}

func commandResult(err error, stderr io.Writer) int {
	if err != nil {
		var f *Fail
		if errors.As(err, &f) {
			fmt.Fprintln(stderr, "pocketcontext: "+err.Error())
			return f.Code
		}
		fmt.Fprintln(stderr, "pocketcontext: "+err.Error())
		return 1
	}
	return 0
}

func run(argv []string) error {
	// Global options may precede the command: pocketcontext --db PATH COMMAND ...
	var global []string
	for len(argv) > 0 && strings.HasPrefix(argv[0], "--") {
		name, _, hasValue := strings.Cut(argv[0][2:], "=")
		switch {
		case name == "pretty":
			global, argv = append(global, argv[0]), argv[1:]
		case (name == "db" || name == "url") && hasValue:
			global, argv = append(global, argv[0]), argv[1:]
		case (name == "db" || name == "url") && len(argv) > 1:
			global, argv = append(global, argv[0], argv[1]), argv[2:]
		default:
			goto parsed
		}
	}
parsed:
	if len(argv) > 0 {
		argv = append([]string{argv[0]}, append(global, argv[1:]...)...)
	}
	if len(argv) == 0 || argv[0] == "--help" || argv[0] == "-h" {
		return printHelp("")
	}
	command, rest := argv[0], argv[1:]
	// Help comes before argument parsing, so `COMMAND --help` works for every command.
	if command == "help" {
		if wantsHelp(rest) {
			return printHelp("help")
		}
		topic, err := helpTopic(rest)
		if err != nil {
			return err
		}
		return printHelp(topic)
	}
	if wantsHelp(rest) {
		if _, known := commandHelp[command]; known {
			return printHelp(command)
		}
	}
	if command == "version" || command == "--version" {
		line := "pocketcontext " + bundle.Version
		if bundle.Commit != "" {
			line += " (" + bundle.Commit + ")"
		}
		fmt.Println(line)
		return nil
	}
	spec := map[string][2][]string{
		"serve":          {{"ui-dev", "port", "domain", "acme-email", "dev-http-address"}, {"take-over", "headless", "tcp-only", "tunnel", "mcp", "hosted", "hosted-init", "hosted-restore", "public-ui-dev"}},
		"start":          {nil, {"take-over"}},
		"ensure-running": {nil, {"take-over"}},
		"stop":           {nil, nil},
		"status":         {nil, nil},
		"open":           {nil, {"no-browser", "skip-reader", "public"}},
		"environment":    {nil, nil},
		"flush":          {nil, nil},
		"recover":        {{"keep"}, nil},
		"init":           {{"port", "name"}, {"password-stdin"}},
		"name":           {nil, nil},
		"manual":         {{"out"}, nil},
		"profile":        {{"name", "binary", "skill-dir", "agent"}, nil},
		"password":       {nil, {"password-stdin"}},
		"skill":          {{"agent", "dir"}, nil},
		"whoami":         {nil, nil},
		"login-code":     {{"ttl"}, nil},
		"login":          {nil, {"password-stdin", "code-stdin"}},
		"logout":         {nil, nil},
		"tunnel":         {{"out", "file"}, {"new-address", "address-stdin", "save", "stdin", "foreground", "background", "no-browser", "skip-reader"}},
	}
	s, known := spec[command]
	if !known {
		return fail(2, "unknown command %q; run `pocketcontext help`", command)
	}
	a, err := parseArgs(rest, s[0], s[1])
	if err != nil {
		return err
	}
	pretty := a.bools["pretty"]
	if command == "environment" {
		if len(a.pos) != 0 || len(a.flags) != 0 {
			return fail(2, "usage: pocketcontext environment [--pretty]")
		}
		Print(bundle.ReaderEnvironment(), pretty)
		return nil
	}
	if command == "open" {
		if err := a.need(0, "open [--public | --no-browser | --skip-reader]"); err != nil {
			return err
		}
		if a.bools["skip-reader"] && (a.bools["no-browser"] || a.bools["public"]) {
			return fail(2, "choose --public, --no-browser or --skip-reader; --skip-reader cannot issue a link")
		}
	}

	if command == "manual" {
		return exportManual(a, pretty)
	}
	if command == "profile" {
		return runProfile(a, pretty)
	}
	// The tunnel carries the port between computers; it is neither a server
	// nor a data operation, so it chooses its own side below.
	if command == "tunnel" {
		return runTunnel(a, pretty)
	}
	// --url, or POCKETCONTEXT_URL without an explicit --db, selects remote mode.
	remote, fromFlag := a.flags["url"], a.has("url")
	if fromFlag && a.has("db") {
		return fail(2, "choose --url or --db, not both")
	}
	if !fromFlag && !a.has("db") {
		remote = os.Getenv("POCKETCONTEXT_URL")
	}
	if fromFlag || remote != "" {
		if command == "open" && a.bools["public"] {
			return fail(2, "open --public runs on the hosting computer; use --db, not --url")
		}
		base, err := normalizeURL(remote)
		if err != nil {
			return err
		}
		return runRemote(base, command, a, pretty)
	}
	if command == "login" || command == "logout" {
		return fail(2, "usage: pocketcontext %s --url http://127.0.0.1:PORT", command)
	}
	if command == "open" && !a.bools["public"] {
		if out := skippedReader(a.bools["no-browser"], a.bools["skip-reader"]); out != nil {
			Print(out, pretty)
			return nil
		}
	}
	p, err := bundle.Resolve(a.flags["db"])
	if err != nil {
		return fail(2, "%v", err)
	}
	switch command {
	case "serve":
		if err := validateHTTPSArgs(a); err != nil {
			return err
		}
		if a.has("ui-dev") && a.flags["ui-dev"] == "" {
			return fail(2, "--ui-dev needs a loopback Vite URL")
		}
		if a.bools["headless"] && (a.bools["tcp-only"] || a.has("port") || (a.has("ui-dev") && !a.bools["public-ui-dev"])) {
			return fail(2, "--headless cannot be combined with TCP or UI development options")
		}
		servePort := 0
		if a.has("port") {
			n, e := a.intFlag("port", 0)
			if e != nil || n < 1024 || n > 65535 {
				return fail(2, "--port must be 1024-65535")
			}
			servePort = n
		}
		opts := bundle.ServeOptions{TakeOver: a.bools["take-over"], UIDev: a.flags["ui-dev"], PublicUIDev: a.bools["public-ui-dev"], DevHTTPAddress: a.flags["dev-http-address"], Headless: a.bools["headless"], TCPOnly: a.bools["tcp-only"], Port: servePort, HTTPSDomain: a.flags["domain"], ACMEEmail: a.flags["acme-email"]}
		opts.Hosted = a.bools["hosted"]
		opts.HostedInit = a.bools["hosted-init"]
		opts.HostedRestore = a.bools["hosted-restore"]
		opts.MCP = a.bools["mcp"]
		if opts.MCP {
			opts.MCPHandler = newMCPHandler
		}
		if a.bools["tunnel"] {
			if !opts.Headless {
				return fail(2, "--tunnel requires --headless")
			}
			return serveWithTunnel(p, opts, pretty)
		}
		return bundle.Serve(p, opts)
	case "start", "ensure-running":
		if err := bundle.EnsureRunning(p, bundle.StartOptions{TakeOver: a.bools["take-over"]}); err != nil {
			return fail(1, "%v", err)
		}
		Print(map[string]any{"status": "running", "url": p.URL(), "db": p.DB, "instance": p.Config.Instance}, pretty)
		return nil
	case "stop":
		if err := bundle.Stop(p); err != nil {
			return fail(1, "%v", err)
		}
		Print(map[string]any{"status": "stopped", "db": p.DB}, pretty)
		return nil
	case "status":
		running, err := bundle.Running(p)
		lease, _ := bundle.ReadLease(p)
		out := map[string]any{"db": p.DB, "url": p.URL(), "running": running, "config": p.ConfigPath, "storage": p.StorageDir(),
			"cache": p.Cache, "log": p.LogFile(), "lease": lease, "conflicts": bundle.Conflicts(p), "version": bundle.Version, "name": p.Config.Name, "instance": p.Config.Instance, "tcp": false, "headless": false}
		out["socket"], _ = p.SocketPath()
		out["port"] = p.Config.Port
		if info, e := bundle.Health(p); e == nil && running {
			out["socket"], out["tcp"], out["headless"], out["port"], out["serverVersion"] = info.Socket, info.TCP, info.Headless, info.Port, info.Version
			out["databaseFormat"] = info.DatabaseFormat
			out["publicURL"] = info.PublicURL
			if info.MCPURL != "" {
				out["mcpURL"] = info.MCPURL
			}
			compatErr := bundle.CheckServerCompatibility(info)
			out["compatible"] = compatErr == nil
			if compatErr != nil {
				out["compatibilityError"] = compatErr.Error()
			}
		}
		if err != nil {
			out["error"] = err.Error()
		}
		Print(out, pretty)
		return nil
	case "flush":
		if err := bundle.EnsureRunning(p, bundle.StartOptions{}); err != nil {
			return fail(1, "%v", err)
		}
		data, err := bundle.LocalCall(p, "/api/bundle/flush", map[string]any{})
		if err != nil {
			return fail(1, "%v", err)
		}
		Print(data, pretty)
		return nil
	case "recover":
		keep := a.flags["keep"]
		if keep != "local" && keep != "synced" {
			return fail(2, "usage: pocketcontext recover --keep local|synced")
		}
		if err := bundle.Recover(p, keep == "local"); err != nil {
			return fail(1, "%v", err)
		}
		Print(map[string]any{"recovered": keep, "db": p.DB}, pretty)
		return nil
	case "name":
		return projectName(p, a, pretty)
	case "init":
		return initProject(p, a, pretty)
	case "password":
		password, err := readPassword(a.bools["password-stdin"], true)
		if err != nil {
			return err
		}
		if _, err := New(p); err != nil {
			return err
		}
		result, err := bundle.LocalCall(p, "/api/bundle/account", map[string]string{"password": password})
		if err != nil {
			return fail(1, "%v", err)
		}
		Print(map[string]any{"password": "changed", "accountCreated": result["created"]}, pretty)
		return nil
	case "open":
		var out map[string]any
		var err error
		if a.bools["public"] {
			out, err = openPublicReader(p)
		} else {
			out, err = openLocalReader(p, a.bools["no-browser"])
		}
		if err != nil {
			return err
		}
		Print(out, pretty)
		return nil
	case "login-code":
		return loginCode(p, a, pretty)
	case "skill":
		return installSkills(p.DB, p.URL(), a.flags["agent"], a.flags["dir"], pretty)
	}
	c, err := New(p)
	if err != nil {
		return err
	}
	if err := checkRegisteredTarget(p.DB, ""); err != nil {
		return err
	}
	return runData(c, command, a, pretty)
}

// localOnly are the server and project commands that need the local database.
var localOnly = map[string]bool{"serve": true, "start": true, "ensure-running": true, "stop": true, "flush": true,
	"recover": true, "init": true, "name": true, "password": true, "login-code": true}

// runRemote runs a command against a forwarded server. It never resolves a
// database or starts a server.
func runRemote(base, command string, a *args, pretty bool) error {
	if command == "open" {
		out, err := openRemoteReader(base, a.bools["no-browser"], a.bools["skip-reader"])
		if err != nil {
			return err
		}
		Print(out, pretty)
		return nil
	}

	if localOnly[command] {
		return fail(2, "%s is not available with --url: the server and its database live on the agent computer; run it there", command)
	}
	switch command {
	case "logout":
		if err := deleteSession(base); err != nil {
			return err
		}
		Print(map[string]any{"url": base, "loggedOut": true}, pretty)
		return nil
	case "status":
		out, err := remoteStatus(base)
		if err != nil {
			return err
		}
		Print(out, pretty)
		return nil
	case "login":
		var out map[string]any
		var err error
		if a.bools["code-stdin"] {
			if a.bools["password-stdin"] {
				return fail(2, "usage: pocketcontext login --url URL (--code-stdin | [--password-stdin])")
			}
			out, err = loginWithCode(base)
		} else {
			out, err = login(base, a.bools["password-stdin"])
		}
		if err != nil {
			return err
		}
		Print(out, pretty)
		return nil
	}
	s, err := loadSession(base)
	if err != nil {
		return err
	}
	if _, err := checkRemote(base, s); err != nil {
		return err
	}
	switch command {
	case "skill":
		return installSkills("", base, a.flags["agent"], a.flags["dir"], pretty)
	}
	if err := checkRegisteredTarget("", base); err != nil {
		return err
	}
	c, err := NewRemote(base)
	if err != nil {
		return err
	}
	return runData(c, command, a, pretty)
}

// runData reports the authenticated instance without selecting a partition.
func runData(c *Client, command string, a *args, pretty bool) error {
	if command != "whoami" {
		return fail(2, "unknown command %q", command)
	}
	if err := a.need(0, "whoami"); err != nil {
		return err
	}
	if _, err := c.Must("POST", "/api/collections/users/auth-refresh", nil); err != nil {
		return err
	}
	out := map[string]any{"url": c.Base, "signedIn": true}
	if raw, err := c.Must("GET", "/api/bundle/instance", nil); err == nil {
		out["name"], out["instance"], out["version"] = dig(raw, "name"), dig(raw, "instance"), dig(raw, "version")
	}
	if c.DB != "" {
		out["db"] = c.DB
	}
	Print(out, pretty)
	return nil
}

const loginCodeTTL = 600

func loginCode(p *bundle.Project, a *args, pretty bool) error {
	if err := a.need(0, "login-code [--ttl SECONDS]"); err != nil {
		return err
	}
	ttl, err := a.intFlag("ttl", loginCodeTTL)
	if err != nil {
		return err
	}
	if !bundle.ValidCodeTTL(ttl) {
		return fail(2, "--ttl must be %d-%d seconds", bundle.MinCodeTTL, bundle.MaxCodeTTL)
	}
	if err := bundle.EnsureRunning(p, bundle.StartOptions{}); err != nil {
		return fail(1, "%v", err)
	}
	result, err := bundle.LocalCall(p, "/api/bundle/login-code", map[string]any{"ttl": ttl})
	if err != nil {
		return fail(1, "%v", err)
	}
	Print(map[string]any{"code": result["code"], "expires": result["expires"]}, pretty)
	return nil
}

// initProject creates the Crew project: its database,
// storage/, pocketcontext.json and the one account, which signs in with a
// password (or a local key or one-time code) under a fixed identity.
func initProject(p *bundle.Project, a *args, pretty bool) error {
	if err := bundle.CheckLocalProject(p); err != nil {
		return err
	}
	if err := a.need(0, "init [--name NAME] [--port N] [--password-stdin]"); err != nil {
		return err
	}
	_, statErr := os.Stat(p.ConfigPath)
	fresh := errors.Is(statErr, os.ErrNotExist)
	// Inspect the existing server before changing name or port in its settings.
	// A foreign TCP listener can coexist with a headless project; EnsureRunning
	// handles that case later. Only this project's running server is checked here.
	if running, _ := bundle.Running(p); running {
		info, err := bundle.Health(p)
		if err != nil {
			return err
		}
		if err := bundle.CheckServerCompatibility(info); err != nil {
			return err
		}
		if info.Hosted {
			return fail(2, "hosted instances cannot be initialized through local init")
		}
	}
	if fresh && !a.has("name") {
		p.Config.Name = filepath.Base(p.Dir)
		if err := profiles.ValidateName(p.Config.Name); err != nil {
			return fail(2, "choose a Crew instance name with --name")
		}
	}
	if a.has("name") {
		name := strings.TrimSpace(a.flags["name"])
		if err := profiles.ValidateName(name); err != nil {
			return fail(2, "%v", err)
		}
		p.Config.Name = name
	}
	if fresh && !a.has("port") {
		n, e := availablePort()
		if e != nil {
			return e
		}
		p.Config.Port = n
	}
	if a.has("port") {
		port, err := a.intFlag("port", 0)
		if err != nil || port < 1024 || port > 65535 {
			return fail(2, "--port must be 1024-65535")
		}
		p.Config.Port = port
	}
	if err := os.MkdirAll(p.Dir, 0755); err != nil {
		return err
	}
	if err := p.EnsureInstance(); err != nil {
		return err
	}
	if err := p.SaveConfig(); err != nil {
		return err
	}
	if err := bundle.EnsureRunning(p, bundle.StartOptions{}); err != nil {
		return fail(1, "%v", err)
	}
	// An existing account (for example created on another computer) keeps its password.
	_, existsErr := bundle.LocalCall(p, "/api/bundle/token", map[string]any{})
	created := false
	if existsErr != nil || a.bools["password-stdin"] {
		password, err := readPassword(a.bools["password-stdin"], true)
		if err != nil {
			return err
		}
		result, err := bundle.LocalCall(p, "/api/bundle/account", map[string]string{"password": password})
		if err != nil {
			return fail(1, "%v", err)
		}
		created, _ = result["created"].(bool)
	}
	if _, err := bundle.LocalCall(p, "/api/bundle/flush", map[string]any{}); err != nil {
		return fail(1, "saving %s: %v", p.DB, err)
	}
	Print(map[string]any{"db": p.DB, "config": p.ConfigPath, "storage": p.StorageDir(), "url": p.URL(),
		"accountCreated": created, "newProject": fresh, "next": "Run `pocketcontext open` to sign in to the reader, and `pocketcontext skill` to install the agent skills."}, pretty)
	return nil
}
