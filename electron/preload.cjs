/**
 * The renderer bridge.
 *
 * Empty, and worth keeping that way. The window loads an ordinary web page from the local
 * server, and everything that needs the filesystem — the database, the templates, the archived
 * originals — happens in the server process, where it already has to.
 *
 * `contextIsolation` is on and `nodeIntegration` off in main.js. Anything exposed here would be
 * reachable from page JavaScript, so a bridge is only worth adding for something the HTTP
 * server genuinely cannot do.
 */

// Intentionally empty.
