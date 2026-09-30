/* Desktop shell for roadmap-tree (Electron).
 *
 * Serves the app files from a tiny loopback-only HTTP server so the page
 * behaves exactly as it does in a browser (fetch, localStorage). The data
 * file lives in the user's app-data folder, not inside the installed app:
 *   GET /roadmap.json  -> that file (example tree on first run)
 *   PUT /roadmap.json  -> overwrite it (used by the Save button)
 */
'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 47631; // fixed so localStorage (drafts, timer) keeps the same origin
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.woff2': 'font/woff2',
};
const STATIC = new Set(['index.html', 'styles.css', 'app.js', 'markdown.js']);

let dataFile;

/** A small generic tree shown on first run so new users see how it works. */
const EXAMPLE = {
  title: 'My roadmap',
  nodes: [
    {
      id: 'ex', label: 'Example project', note: 'delete me',
      children: [
        { id: 'ex1', label: 'Plan', status: 'done', children: [
          { id: 'ex1a', label: 'Write down the goals', status: 'done' },
          { id: 'ex1b', label: 'Pick the tools', status: 'done' },
        ] },
        { id: 'ex2', label: 'Build', status: 'active', note: 'click the dot to change status', children: [
          {
            id: 'ex2a', label: 'First prototype', status: 'active', note: 'hover a row and press ▶ to time it',
            md: '## Notes\n\nClick a step to open its notes here. They support **Markdown** and LaTeX math.\n\n'
              + '- Inline: $e^{i\\pi} + 1 = 0$\n- Block:\n\n$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$\n\n'
              + '- [ ] Drag any step to reorder it\n',
          },
          { id: 'ex2b', label: 'Polish', status: 'planned' },
        ] },
        { id: 'ex3', label: 'Launch', status: 'planned', note: 'hover a row for + and ×' },
      ],
    },
  ],
  log: [],
};

/** First run: write the example tree (the bundled roadmap.json is only a dev sample). */
function ensureDataFile() {
  dataFile = path.join(app.getPath('userData'), 'roadmap.json');
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify(EXAMPLE, null, 2) + '\n');
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

    if (url === '/update/check' && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== origin) { res.writeHead(403).end(); return; }
      checkNow().then((r) => {
        res.writeHead(200, { 'Content-Type': TYPES['.json'] });
        res.end(JSON.stringify(r));
      });
      return;
    }

    if (url === '/version.json') {
      res.writeHead(200, { 'Content-Type': TYPES['.json'] });
      res.end(JSON.stringify({ version: app.getVersion() }));
      return;
    }

    const name = url === '/' ? 'index.html' : decodeURIComponent(url.slice(1));
    const isVendor = /^vendor\/[\w.\-/]+$/.test(name) && !name.includes('..');
    if (!STATIC.has(name) && !isVendor) { res.writeHead(404).end(); return; }
    if (!fs.existsSync(path.join(ROOT, name))) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream' });
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
  // Links in notes open in the normal browser (web links only), never inside the app window.
  const openWeb = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { openWeb(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith(origin)) { ev.preventDefault(); openWeb(url); }
  });
}

/**
 * Auto-update from GitHub Releases (installed builds only). Checks at
 * startup and every 4 hours; a new version downloads in the background and
 * the user chooses when to restart into it.
 */
let updater = null; // set by setupAutoUpdate(); null when running from source

/**
 * Manual "Check for updates" (POST /update/check). Resolves to
 * { status: 'dev' | 'available' | 'none' | 'error', version?, message? }.
 * An available update downloads automatically; the restart dialog below follows.
 */
async function checkNow() {
  if (!updater) return { status: 'dev' };
  try {
    const r = await updater.checkForUpdates();
    const latest = r && r.updateInfo && r.updateInfo.version;
    const available = r && r.isUpdateAvailable !== undefined ? r.isUpdateAvailable : latest && latest !== app.getVersion();
    return available ? { status: 'available', version: latest } : { status: 'none', version: app.getVersion() };
  } catch (e) {
    return { status: 'error', message: e && e.message ? e.message.split('\n')[0] : 'unknown error' };
  }
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
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
