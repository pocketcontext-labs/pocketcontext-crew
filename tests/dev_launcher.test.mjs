import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertPortAvailable,
  launchConfiguration,
  parseOptions,
  projectOptions,
  superviseFrontend,
} from "../scripts/dev.mjs";

test("launcher requires an explicit database and valid port", () => {
  assert.throws(() => parseOptions([]), /explicit development database/);
  assert.throws(
    () => parseOptions(["--db", "--binary", "bin/pocketcontext-crew"]),
    /Usage/,
  );
  assert.throws(
    () => parseOptions(["--db", "example.db", "--vite-port", "0"]),
    /Port/,
  );
  assert.throws(
    () => parseOptions(["--db", "example.db", "--take-over"]),
    /Usage/,
  );
});

test("launcher reads only explicit project settings and refuses missing databases", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pocketcontext-launcher-"));
  try {
    const db = join(folder, "pocketcontext.db");
    await assert.rejects(
      projectOptions(parseOptions(["--db", db])),
      /Initialize/,
    );
    await writeFile(db, "synthetic");
    assert.equal((await projectOptions(parseOptions(["--db", folder]))).db, db);
    assert.equal((await projectOptions(parseOptions(["--db", db]))).port, 8099);
    await writeFile(
      join(folder, "pocketcontext.json"),
      JSON.stringify({ port: 18123 }),
    );
    assert.equal(
      (await projectOptions(parseOptions(["--db", db]))).port,
      18123,
    );
    await assert.rejects(
      projectOptions(parseOptions(["--db", db, "--vite-port", "18123"])),
      /different ports/,
    );
    await writeFile(
      join(folder, "pocketcontext.json"),
      JSON.stringify({ port: "18123" }),
    );
    await assert.rejects(projectOptions(parseOptions(["--db", db])), /Port/);
    await writeFile(join(folder, "pocketcontext.json"), "broken JSON");
    await assert.rejects(
      projectOptions(parseOptions(["--db", db])),
      SyntaxError,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("launcher refuses an occupied port without touching its listener", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await assert.rejects(assertPortAvailable(port), /already in use/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await assertPortAvailable(port);
});

test("public launch requires an exact DNS origin and loopback upstream", () => {
  for (const domain of [
    "https://dev.example.test",
    "dev.example.test:443",
    "*.example.test",
    "dev.example.test/path",
    "127.0.0.1",
    "UPPER.example.test",
    "bad_.example.test",
  ]) {
    assert.throws(
      () => parseOptions(["--db", "example.db", "--public-domain", domain]),
      /domain/i,
    );
  }
  for (const address of [
    "0.0.0.0:18098",
    "localhost:18098",
    "127.0.0.1:80",
    "127.0.0.1:70000",
  ]) {
    assert.throws(
      () =>
        parseOptions([
          "--db",
          "example.db",
          "--public-domain",
          "dev.example.test",
          "--dev-http-address",
          address,
        ]),
      /address|Port/i,
    );
  }
  assert.throws(
    () =>
      parseOptions([
        "--db",
        "example.db",
        "--dev-http-address",
        "127.0.0.1:18098",
      ]),
    /requires --public-domain/,
  );
  const options = {
    ...parseOptions([
      "--db",
      "example.db",
      "--public-domain",
      "dev.example.test",
      "--vite-port",
      "5174",
    ]),
    port: 8099,
  };
  const configured = launchConfiguration(options, {
    PATH: "/synthetic/bin",
    POCKETCONTEXT_SMTP_PASSWORD: "synthetic-secret",
    POCKETCONTEXT_DEV_PUBLIC_DOMAIN: "stale.example.test",
  });
  assert.equal(configured.origin, "https://dev.example.test");
  assert.equal(configured.upstream, "http://127.0.0.1:5174");
  assert.deepEqual(configured.args.slice(5), [
    "--headless",
    "--hosted",
    "--domain",
    "dev.example.test",
    "--mcp",
    "--public-ui-dev",
    "--dev-http-address",
    "127.0.0.1:18098",
  ]);
  assert.equal(
    configured.viteEnv.POCKETCONTEXT_DEV_PUBLIC_DOMAIN,
    "dev.example.test",
  );
  assert.equal(configured.viteEnv.POCKETCONTEXT_SMTP_PASSWORD, undefined);
  assert.equal(configured.viteEnv.PATH, "/synthetic/bin");
  const local = launchConfiguration(
    { ...parseOptions(["--db", "example.db"]), port: 8099 },
    configured.viteEnv,
  );
  assert.equal(local.viteEnv.POCKETCONTEXT_DEV_PUBLIC_DOMAIN, undefined);
  assert.equal(local.args.includes("--public-ui-dev"), false);
});

test("public launcher checks the private HTTP port rather than the disabled local reader port", async () => {
  const folder = await mkdtemp(join(tmpdir(), "crew-public-launcher-"));
  try {
    const db = join(folder, "pocketcontext.db");
    await writeFile(db, "synthetic");
    await writeFile(
      join(folder, "pocketcontext.json"),
      JSON.stringify({ port: 5174 }),
    );
    const args = [
      "--db",
      db,
      "--public-domain",
      "dev.example.test",
      "--vite-port",
      "5174",
    ];
    const options = await projectOptions(parseOptions(args));
    assert.equal(options.listenPort, 18098);
    await assert.rejects(
      projectOptions(
        parseOptions([...args, "--dev-http-address", "127.0.0.1:5174"]),
      ),
      /different ports/,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("public frontend supervision survives crashes with bounded backoff and stops before a post-abort restart", async () => {
  const controller = new AbortController();
  const waits = [];
  let restarts = 0;
  let finished = false;
  const crashed = () => ({ exited: Promise.resolve("exit 1") });
  const supervision = superviseFrontend(
    crashed(),
    () => {
      restarts++;
      return crashed();
    },
    controller.signal,
    {
      report() {},
      async wait(milliseconds) {
        assert.equal(finished, false, "frontend exit must not end supervision");
        waits.push(milliseconds);
        if (waits.length === 7) controller.abort();
      },
    },
  ).then(() => {
    finished = true;
  });
  await supervision;
  assert.deepEqual(waits, [500, 1000, 2000, 4000, 8000, 10000, 10000]);
  assert.equal(restarts, 6);
  assert.equal(finished, true);
});

test("public frontend supervision aborts during backoff without restarting", async () => {
  const controller = new AbortController();
  let restarts = 0;
  await superviseFrontend(
    { exited: Promise.resolve("exit 1") },
    () => {
      restarts++;
    },
    controller.signal,
    {
      report() {
        queueMicrotask(() => controller.abort());
      },
    },
  );
  assert.equal(restarts, 0);
});

test("public frontend supervision stops while a healthy frontend is still running", async () => {
  const controller = new AbortController();
  let restarts = 0;
  const supervision = superviseFrontend(
    { exited: new Promise(() => {}) },
    () => {
      restarts++;
    },
    controller.signal,
  );
  controller.abort();
  await supervision;
  assert.equal(restarts, 0);
});
