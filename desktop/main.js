/* Desktop shell for roadmap-tree (Electron).
 *
 * Serves the app files from a tiny loopback-only HTTP server so the page
 * behaves exactly as it does in a browser (fetch, localStorage). The data
 * file lives in the user's app-data folder, not inside the installed app:
 *   GET /roadmap.json  -> that file (seeded from the bundled copy on first run)
 *   PUT /roadmap.json  -> overwrite it (used by the Save button)
 */
'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 47631; // fixed so localStorage (drafts, timer) keeps the same origin
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const STATIC = new Set(['index.html', 'styles.css', 'app.js']);

let dataFile;

/** Copy the bundled roadmap.json into app-data the first time. */
function ensureDataFile() {
  dataFile = path.join(app.getPath('userData'), 'roadmap.json');
  if (!fs.existsSync(dataFile)) fs.copyFileSync(path.join(ROOT, 'roadmap.json'), dataFile);
}

function startServer() {
  const origin = `http://127.0.0.1:${PORT}`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin).pathname;

    if (url === '/roadmap.json') {
      if (req.method === 'PUT') {
        // Refuse writes from web pages on other origins.
        if (req.headers.origin && req.headers.origin !== origin) { res.writeHead(403).end(); return; }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            JSON.parse(body); // never write something that isn't JSON
            fs.writeFileSync(dataFile, body);
            res.writeHead(204).end();
          } catch { res.writeHead(400).end(); }
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
      fs.createReadStream(dataFile).pipe(res);
      return;
    }

    const name = url === '/' ? 'index.html' : url.slice(1);
    if (!STATIC.has(name)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] });
    fs.createReadStream(path.join(ROOT, name)).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(origin));
  });
}

async function createWindow() {
  const origin = await startServer();
  const win = new BrowserWindow({ width: 1100, height: 720, autoHideMenuBar: true, title: 'Roadmap Tree' });
  win.loadURL(origin);
  // Links that leave the app open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

/**
 * Auto-update from GitHub Releases (installed builds only). Checks at
 * startup and every 4 hours; a new version downloads in the background and
 * the user chooses when to restart into it.
 */
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.on('error', (e) => console.warn('update check failed:', e && e.message));
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      title: 'Update ready',
      message: `Roadmap Tree ${info.version} has been downloaded.`,
      detail: 'Restart to install it. If you choose Later, it installs the next time you quit.',
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

// One window at a time (the port is fixed, so a second instance couldn't bind it).
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(async () => { ensureDataFile(); await createWindow(); setupAutoUpdate(); });
  app.on('window-all-closed', () => app.quit());
}
