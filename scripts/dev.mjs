#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, stat } from "node:fs/promises";
import { createServer, isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const usage =
  "Usage: node scripts/dev.mjs --db PATH [--binary PATH] [--vite-port 5173] [--public-domain HOST --dev-http-address 127.0.0.1:18098]";
const execFileAsync = promisify(execFile);

export function parseOptions(args) {
  const options = {
    binary: join(
      root,
      "bin",
      process.platform === "win32" ? "pocketcontext-crew.exe" : "pocketcontext-crew",
    ),
    vitePort: 5173,
  };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (
      ![
        "--db",
        "--binary",
        "--vite-port",
        "--public-domain",
        "--dev-http-address",
      ].includes(name) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    ) {
      throw new Error(usage);
    }
    const value = args[++i];
    if (name === "--vite-port") options.vitePort = validPort(Number(value));
    else if (name === "--public-domain")
      options.publicDomain = validDomain(value);
    else if (name === "--dev-http-address")
      options.devHTTPAddress = validDevAddress(value);
    else options[name.slice(2)] = resolve(value);
  }
  if (!options.db)
    throw new Error(`An explicit development database is required. ${usage}`);
  if (options.devHTTPAddress && !options.publicDomain)
    throw new Error("--dev-http-address requires --public-domain");
  if (options.publicDomain) options.devHTTPAddress ||= "127.0.0.1:18098";
  return options;
}

function validDomain(value) {
  if (
    value.length > 253 ||
    !value.includes(".") ||
    isIP(value) ||
    !value
      .split(".")
      .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  )
    throw new Error(
      "Public domain must be a lowercase DNS hostname without scheme, port or path",
    );
  return value;
}

function validDevAddress(value) {
  const match = /^127\.0\.0\.1:([0-9]+)$/.exec(value);
  if (!match)
    throw new Error("Development HTTP address must be 127.0.0.1:PORT");
  validPort(Number(match[1]));
  return value;
}

export function launchConfiguration(options, inherited = {}) {
  const upstream = `http://127.0.0.1:${options.vitePort}`;
  const origin = options.publicDomain
    ? `https://${options.publicDomain}`
    : `http://127.0.0.1:${options.port}`;
  const args = ["serve", "--db", options.db, "--ui-dev", upstream];
  // Vite needs the toolchain environment, not hosted SMTP/backup bindings or
  // stale development settings. Only the backend inherits runtime bindings.
  const viteEnv = Object.fromEntries(
    Object.entries(inherited).filter(
      ([key]) => !key.startsWith("POCKETCONTEXT_"),
    ),
  );
  viteEnv.POCKETCONTEXT_DEV_PORT = String(options.port);
  if (options.publicDomain) {
    args.push(
      "--headless",
      "--hosted",
      "--domain",
      options.publicDomain,
      "--mcp",
      "--public-ui-dev",
      "--dev-http-address",
      options.devHTTPAddress,
    );
    viteEnv.POCKETCONTEXT_DEV_PUBLIC_DOMAIN = options.publicDomain;
  }
  return { args, viteEnv, upstream, origin };
}

function validPort(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error("Port must be 1024-65535");
  return value;
}

export async function projectOptions(options) {
  const info = await stat(options.db).catch((error) => {
    if (error.code === "ENOENT")
      throw new Error(
        "Initialize an explicit development database with pocketcontext init --db PATH first.",
      );
    throw error;
  });
  const db = info.isDirectory()
    ? join(options.db, "pocketcontext.db")
    : options.db;
  await access(db);
  let config = {};
  try {
    config = JSON.parse(
      await readFile(join(dirname(db), "pocketcontext.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const port = validPort(
    config.port === undefined || config.port === 0 ? 8099 : config.port,
  );
  const listenPort = options.publicDomain
    ? Number(options.devHTTPAddress.split(":")[1])
    : port;
  if (listenPort === options.vitePort)
    throw new Error("PocketContext and Vite must use different ports");
  return { ...options, db, port, listenPort };
}

export async function assertPortAvailable(port) {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is already in use. Stop its server explicitly or choose another port.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  const state = { child, done: false };
  state.exited = new Promise((resolvePromise) => {
    child.once("error", (error) => {
      state.done = true;
      resolvePromise(error.message);
    });
    child.once("exit", (code, signal) => {
      state.done = true;
      resolvePromise(signal || `exit ${code}`);
    });
  });
  return state;
}

async function waitReady(url, state, signal, check) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (state.done)
      throw new Error(
        `Process stopped before readiness: ${await state.exited}`,
      );
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
      });
      const ready = response.ok && (await check(response));
      if (!response.bodyUsed) await response.body?.cancel();
      if (ready && !state.done) return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await delay(150, undefined, { signal });
  }
  throw new Error(`Server did not become ready within 60 seconds: ${url}`);
}

// Public MCP stays available while Vite is unavailable. Restarts back off from
// 500ms to 10s; a frontend that stays alive for 30s resets the delay.
export async function superviseFrontend(
  initial,
  restart,
  signal,
  {
    wait = (milliseconds, abortSignal) =>
      delay(milliseconds, undefined, { signal: abortSignal }),
    report = (milliseconds) =>
      console.error(
        `UI development server stopped; MCP remains available. Restarting Vite in ${milliseconds}ms.`,
      ),
  } = {},
) {
  if (signal.aborted) return;
  let current = initial;
  let backoff = 500;
  let startedAt = Date.now();
  let onAbort;
  const aborted = new Promise((resolvePromise) => {
    onAbort = resolvePromise;
  });
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (!signal.aborted) {
      await Promise.race([current.exited, aborted]);
      if (signal.aborted) return;
      if (Date.now() - startedAt >= 30_000) backoff = 500;
      report(backoff);
      try {
        await wait(backoff, signal);
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
      if (signal.aborted) return;
      current = restart();
      startedAt = Date.now();
      backoff = Math.min(backoff * 2, 10_000);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function terminate(state, timeout = 5000) {
  if (!state || state.done) return;
  state.child.kill("SIGTERM");
  await Promise.race([state.exited, delay(timeout, undefined, { ref: false })]);
  if (!state.done) {
    state.child.kill("SIGKILL");
    await state.exited;
  }
}

export async function run(args) {
  const options = await projectOptions(parseOptions(args));
  const vite = join(root, "ui", "node_modules", "vite", "bin", "vite.js");
  await access(options.binary).catch(() => {
    throw new Error(
      `Build PocketContext once with make build; executable missing: ${options.binary}`,
    );
  });
  await access(vite).catch(() => {
    throw new Error(
      "Install frontend dependencies first: pnpm --dir ui install --frozen-lockfile",
    );
  });
  await assertPortAvailable(options.listenPort);
  await assertPortAvailable(options.vitePort);
  const controller = new AbortController();
  let finish;
  const interrupted = new Promise((resolvePromise) => {
    finish = resolvePromise;
  });
  const onSignal = () => {
    controller.abort();
    finish();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const config = launchConfiguration(options, process.env);
  let frontend;
  let backend;
  let backendReady = false;
  let frontendSupervisor;
  const frontendController = new AbortController();
  const startFrontend = () =>
    start(process.execPath, [vite, "--port", String(options.vitePort)], {
      cwd: join(root, "ui"),
      env: config.viteEnv,
    });
  try {
    frontend = startFrontend();
    const { upstream, origin } = config;
    await waitReady(upstream, frontend, controller.signal, async () => true);
    backend = start(options.binary, config.args, { cwd: root });
    await waitReady(
      options.publicDomain
        ? `http://${options.devHTTPAddress}/up`
        : `${origin}/api/bundle/instance`,
      backend,
      controller.signal,
      async (response) => {
        if (options.publicDomain) {
          const { stdout } = await execFileAsync(
            options.binary,
            ["status", "--db", options.db],
            { timeout: 3000, maxBuffer: 1024 * 1024 },
          );
          const status = JSON.parse(stdout);
          return (
            status.running === true &&
            status.lease?.pid === backend.child.pid &&
            status.publicURL === origin &&
            status.mcpURL === `${origin}/mcp`
          );
        }
        const instance = await response.json();
        const config = JSON.parse(
          await readFile(
            join(dirname(options.db), "pocketcontext.json"),
            "utf8",
          ),
        );
        return (
          instance.app === "pocketcontext-crew" &&
          instance.instance === config.instance &&
          instance.pid === backend.child.pid &&
          instance.uiDev === upstream
        );
      },
    );
    backendReady = true;
    console.log(
      options.publicDomain
        ? `\nDevelopment backend ready for ${origin}. Configure the HTTPS proxy to ${options.devHTTPAddress}; sign in with the development owner email. MCP: ${origin}/mcp`
        : `\nReader ready at ${origin}. Sign in there, or run pocketcontext-crew open --db PATH in another terminal.`,
    );
    console.log(
      "Edit ui/src for hot updates. Press Ctrl-C to stop both development processes.\n",
    );
    const waits = [
      interrupted,
      backend.exited.then((value) => `PocketContext stopped (${value})`),
    ];
    if (options.publicDomain) {
      frontendSupervisor = superviseFrontend(
        frontend,
        () => {
          frontend = startFrontend();
          return frontend;
        },
        frontendController.signal,
      );
      waits.push(frontendSupervisor);
    } else {
      waits.push(frontend.exited.then((value) => `Vite stopped (${value})`));
    }
    const result = await Promise.race(waits);
    if (result) throw new Error(result);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    frontendController.abort();
    await frontendSupervisor?.catch(() => {});
    if (backendReady && !backend.done) {
      // The authenticated stop endpoint flushes snapshots on Windows as well as Unix.
      const stop = start(options.binary, ["stop", "--db", options.db], {
        stdio: "ignore",
      });
      await Promise.race([
        stop.exited,
        delay(35_000, undefined, { ref: false }),
      ]);
      await terminate(stop);
      await Promise.race([
        backend.exited,
        delay(5000, undefined, { ref: false }),
      ]);
    }
    await terminate(backend, 35_000);
    await terminate(frontend);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.slice(2).includes("--help")) console.log(usage);
  else
    run(process.argv.slice(2)).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
