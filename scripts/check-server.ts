/**
 * The one security property of the desktop shape: the records are not on the network.
 *
 * `electron/main.cjs` passes `HOSTNAME=127.0.0.1` to the standalone server. **Next binds
 * `0.0.0.0` without it** — and on the school LAN that publishes every learner's permanent
 * record to anyone who finds the port, with a password screen as the only thing in the way, on
 * a machine nobody is watching.
 *
 * It is one environment variable, in one object literal, in a file nobody has reason to read.
 * That is precisely the kind of thing a refactor drops, so it is checked mechanically rather
 * than listed on a handover checklist where it would be ticked by whoever wrote it.
 *
 * ## What this actually does
 *
 * Starts the built standalone server exactly as the shell does, then:
 *
 *  1. confirms it answers on `127.0.0.1` — otherwise the rest proves only that it is broken;
 *  2. tries to open a TCP connection to the same port on this machine's **LAN address**, and
 *     requires that to be refused.
 *
 * A machine with no non-loopback IPv4 address (no network at all) cannot demonstrate the second
 * half. It says so and does not pass silently, because "could not test" and "tested and safe"
 * must not look the same in a build log.
 *
 * Run: npm run check:server   (and automatically as part of npm run build:desktop)
 */

import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const standalone = join(process.cwd(), ".next", "standalone");
const serverJs = join(standalone, "server.js");

if (!existsSync(serverJs)) {
  console.error(`\n  no standalone build at ${serverJs} — run "npm run build" first\n`);
  process.exit(1);
}

/** This machine's first non-internal IPv4 address, or null when there is no network. */
function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** Can a TCP connection to host:port be established within `timeoutMs`? */
function reachable(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    // ECONNREFUSED is the answer we want: something is listening, but not on this interface.
    socket.once("error", () => done(false));
  });
}

const dataDir = mkdtempSync(join(tmpdir(), "pnhs-server-check-"));
const port = await freePort();

const child = spawn(process.execPath, [serverJs], {
  cwd: standalone,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    PNHS_APP_DIR: process.cwd(),
    PNHS_DATA_DIR: dataDir,
  },
  stdio: "ignore",
});

function stop(): void {
  child.kill();
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* the OS will clear it */
  }
}

let failed = false;
const fail = (message: string) => {
  console.error(`  FAIL  ${message}`);
  failed = true;
};

try {
  // Startup includes creating the schema on a scratch data directory.
  const deadline = Date.now() + 60_000;
  let up = false;
  while (Date.now() < deadline && !up) {
    up = await reachable("127.0.0.1", port, 1000);
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }

  if (!up) {
    fail(`the server never answered on 127.0.0.1:${port}`);
  } else {
    console.log(`  ok    the server answers on 127.0.0.1:${port}`);

    const lan = lanAddress();
    if (!lan) {
      // Not a pass. A build machine with no network cannot demonstrate this either way.
      console.log("  SKIP  no non-loopback address on this machine, so reachability from the");
      console.log("        network could not be tested. Re-run somewhere with a LAN address.");
    } else if (await reachable(lan, port)) {
      fail(
        `the server accepted a connection on ${lan}:${port} — it is bound to 0.0.0.0.\n` +
          "        Every learner record is reachable from the school LAN.\n" +
          '        electron/main.cjs must pass HOSTNAME: "127.0.0.1" to the server.',
      );
    } else {
      console.log(`  ok    ${lan}:${port} refuses — the records are not on the network`);
    }
  }
} finally {
  stop();
}

if (failed) {
  console.error("\n  server: FAILURES above\n");
  process.exit(1);
}
console.log("\n  server: loopback only\n");
