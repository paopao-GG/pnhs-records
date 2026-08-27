/**
 * The desktop shell.
 *
 * PNHS Records is a Next.js application. This process starts it as a local HTTP server and
 * opens a window pointed at it — the app itself is unchanged, which is the reason for doing it
 * this way: the SF10 exporter, the three importers and the whole of `lib/` are Node code that
 * has to keep running as Node code.
 *
 * Responsibilities here, and nowhere else:
 *
 *  1. Refuse to run twice          — two processes writing one SQLite file corrupt it
 *  2. Decide where the data lives  — outside the install directory, outside any sync folder
 *  3. Start the server on loopback — never on a routable interface
 *  4. Open the window, and stop the server when it closes
 *  5. Put downloads somewhere      — printing an SF10 is a download, and it is the whole point
 */

const electron = require("electron");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");

/*
 * Refuse to start as plain Node, and say why.
 *
 * `ELECTRON_RUN_AS_NODE` turns this executable into a bare Node runtime, and the app then
 * inherits it from whatever launched it. `require("electron")` returns a path string instead of
 * the API, and the first line touching `app` dies with
 * *"Cannot read properties of undefined"* — from a windowless process that has already
 * detached from the console, so the user sees an icon bounce and nothing else.
 *
 * We set that variable ourselves, deliberately, for the server child below (it is what saves
 * bundling a second copy of Node). A shell that already has it set is therefore not a strange
 * hypothetical: it is what this app does to its own children, and it cost an afternoon to
 * diagnose from the outside once already.
 *
 * Nothing can be done about it here — Electron has already decided not to be an application —
 * so this exits with an explanation rather than a stack trace.
 */
if (!electron || typeof electron === "string" || !electron.app) {
  console.error(
    "PNHS Records cannot start: this process is running as plain Node.\n" +
      "ELECTRON_RUN_AS_NODE is set in the environment. Clear it and launch again.",
  );
  process.exit(1);
}

const { app, BrowserWindow, dialog, Menu, session, shell } = electron;

/**
 * Where the records live.
 *
 * `%LOCALAPPDATA%`, deliberately, and not any of the obvious alternatives:
 *
 *  - **not the install directory**, which is read-only for a per-machine install and removed
 *    by the uninstaller either way;
 *  - **not `app.getPath("userData")`**, which is Roaming `%APPDATA%` — on a domain network a
 *    roaming profile is copied at logoff, which is a file-sync tool by another name;
 *  - **never inside OneDrive**. SQLite and file-sync clients corrupt each other: the client
 *    copies the file mid-write and hands back something that is not a database.
 */
function dataDirectory() {
  const local = process.env.LOCALAPPDATA || app.getPath("appData");
  const dir = path.join(local, "PNHS Records");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The unpacked application bundle: the folder holding `db/`, `templates/` and `.next/`. */
function appDirectory() {
  // electron-builder leaves the server unpacked, because Node cannot execute a script from
  // inside an asar archive as a spawned process.
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked")
    : path.join(__dirname, "..");
}

/** Ask the OS for a free port by binding zero, then let it go. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Poll until the server answers, or give up. First startup includes creating the schema. */
async function waitForServer(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Any answer at all means it is listening; a redirect to /unlock is the expected one.
      await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

let serverProcess = null;
let mainWindow = null;

function startServer(port, appDir, dataDir) {
  const serverJs = path.join(appDir, ".next", "standalone", "server.js");
  if (!existsSync(serverJs)) {
    throw new Error(
      `The application server is missing at ${serverJs}. Run "npm run build" before packaging.`,
    );
  }

  /*
   * Electron's own binary, run as plain Node.
   *
   * `ELECTRON_RUN_AS_NODE` turns this executable into a Node runtime for the child, which
   * saves bundling a second copy of Node — around 50 MB of installer for nothing.
   */
  serverProcess = spawn(process.execPath, [serverJs], {
    cwd: path.join(appDir, ".next", "standalone"),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      /*
       * The one security property of this whole design.
       *
       * Next's standalone server binds 0.0.0.0 unless told otherwise. On a school LAN that
       * would publish every learner's permanent record to anyone who guessed the port — and
       * the password screen would be the only thing in the way, on a machine nobody is
       * watching. Loopback means the listener is unreachable from another machine at all.
       */
      HOSTNAME: "127.0.0.1",
      PNHS_APP_DIR: appDir,
      PNHS_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Server output is worth having when something fails at startup and costs nothing when it
  // does not. It reaches the terminal in development and nowhere in a packaged app.
  serverProcess.stdout.on("data", (b) => process.stdout.write(`[server] ${b}`));
  serverProcess.stderr.on("data", (b) => process.stderr.write(`[server] ${b}`));

  serverProcess.on("exit", (code) => {
    serverProcess = null;
    // The server dying while the window is open leaves a shell showing a dead page. Say so,
    // rather than letting someone keep clicking an app that answers nothing.
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "PNHS Records has stopped",
        `The records service exited unexpectedly (code ${code}). Close and reopen the app.`,
      );
    }
  });
}

function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  // The exit handler is what shows the error dialog; this exit is on purpose.
  child.removeAllListeners("exit");
  child.kill();
}

function buildMenu(dataDir) {
  return Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        { label: "Open data folder", click: () => shell.openPath(dataDir) },
        { type: "separator" },
        { role: "quit", label: "Exit" },
      ],
    },
    {
      // Cut/copy/paste are not decoration here: the encoding grid is a text-entry surface and
      // the registrar pastes names into it.
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About PNHS Records",
          click: () =>
            dialog.showMessageBox({
              type: "info",
              title: "PNHS Records",
              message: "PNHS Records",
              detail:
                "Learner permanent records for Pantao National High School.\n\n" +
                `Version ${app.getVersion()}\n\nRecords are stored in:\n${dataDir}`,
            }),
        },
      ],
    },
  ]);
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    // Painted before the page loads, so the window does not flash white while it starts.
    backgroundColor: "#f4f2ee",
    show: false,
    webPreferences: {
      // The window loads a localhost page and needs no Node access of its own. Everything that
      // needs Node runs in the server process, where it already has to.
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  /*
   * A link to anywhere else opens in the real browser, not in this window.
   *
   * There should not be any. But a window that can be navigated away from localhost is a
   * window that can be shown someone else's page while wearing this app's frame.
   */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

/*
 * One instance.
 *
 * Two copies of this app are two processes writing one SQLite file, which is the corruption
 * every other decision here avoids. The second launch hands focus to the first and exits.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const dataDir = dataDirectory();
    const appDir = appDirectory();

    Menu.setApplicationMenu(buildMenu(dataDir));

    /*
     * Downloads land in the Downloads folder, behind a Save dialog.
     *
     * Printing an SF10 is an HTTP download, and it is the reason this application exists. The
     * dialog is deliberate rather than a silent save: the registrar is producing a document
     * for somebody, and needs to know where it went.
     */
    session.defaultSession.on("will-download", (_event, item) => {
      item.setSaveDialogOptions({
        defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
      });
    });

    try {
      const port = await freePort();
      startServer(port, appDir, dataDir);

      if (!(await waitForServer(port))) {
        dialog.showErrorBox(
          "PNHS Records could not start",
          "The records service did not respond. If this keeps happening, reinstall the app.",
        );
        app.quit();
        return;
      }

      createWindow(port);
    } catch (err) {
      dialog.showErrorBox("PNHS Records could not start", String(err?.message ?? err));
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    stopServer();
    app.quit();
  });

  app.on("before-quit", stopServer);
  // A crash in this process must not leave an orphaned server holding the database open.
  process.on("exit", stopServer);
}
