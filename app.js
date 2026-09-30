/* roadmap-tree v0.1
 *
 * Three layers, top to bottom:
 *   1. Model    - pure helpers over the roadmap data (no DOM).
 *   2. Render   - render(tree, view) -> SVG markup string. Pure: same input,
 *                 same output. Interactive bits are tagged with data-action
 *                 and data-id so any host (this page, a VS Code webview) can
 *                 wire up events with delegation.
 *   3. App      - DOM wiring, persistence (localStorage draft, file save).
 */
'use strict';

/* =========================================================================
 * 1. Model
 * ====================================================================== */

const STATUSES = ['planned', 'active', 'done'];

const hasKids = (n) => Array.isArray(n.children) && n.children.length > 0;

/** Next status in the planned -> active -> done -> planned cycle. */
function nextStatus(s) {
  return STATUSES[(STATUSES.indexOf(s) + 1) % STATUSES.length];
}

/**
 * Effective status of a node. An explicit status always wins; a parent
 * without one derives it from its children: all done -> done, anything
 * active or partly done -> active, otherwise planned.
 */
function statusOf(n) {
  if (STATUSES.includes(n.status)) return n.status;
  if (!hasKids(n)) return 'planned';
  const kids = n.children.map(statusOf);
  if (kids.every((s) => s === 'done')) return 'done';
  if (kids.some((s) => s === 'active' || s === 'done')) return 'active';
  return 'planned';
}

/** Depth-first walk. fn(node, depth, parent, path) where path = ancestor labels. */
function walk(nodes, fn, depth = 0, parent = null, path = []) {
  for (const n of nodes) {
    fn(n, depth, parent, path);
    if (hasKids(n)) walk(n.children, fn, depth + 1, n, path.concat(n.label));
  }
}

/** Locate a node by id. Returns { node, parent, siblings } or null. */
function findNode(tree, id) {
  let hit = null;
  walk(tree.nodes, (n, _d, parent) => {
    if (!hit && n.id === id) hit = { node: n, parent, siblings: parent ? parent.children : tree.nodes };
  });
  return hit;
}

/** All leaf nodes (nodes without children), in tree order, with their path. */
function leaves(tree) {
  const out = [];
  walk(tree.nodes, (n, _d, _p, path) => { if (!hasKids(n)) out.push({ node: n, path }); });
  return out;
}

/** Overall progress: share of leaf nodes that are done. */
function progress(tree) {
  const all = leaves(tree);
  const done = all.filter((l) => statusOf(l.node) === 'done').length;
  return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

/**
 * "What's next": every node explicitly marked active (derived parents are
 * skipped so a branch doesn't duplicate its children), then the first
 * `limit` planned leaves in tree order.
 */
function whatsNext(tree, limit = 5) {
  const active = [];
  walk(tree.nodes, (n, _d, _p, path) => { if (n.status === 'active') active.push({ node: n, path }); });
  const planned = leaves(tree).filter((l) => statusOf(l.node) === 'planned').slice(0, limit);
  return { active, planned };
}

/** Ids of every node that has children (used for expand/collapse all). */
function branchIds(tree) {
  const ids = [];
  walk(tree.nodes, (n) => { if (hasKids(n)) ids.push(n.id); });
  return ids;
}

/** A fresh id that doesn't collide with any existing one. */
function newId(tree) {
  const used = new Set();
  walk(tree.nodes, (n) => used.add(n.id));
  let id;
  do { id = 'n' + Math.random().toString(36).slice(2, 8); } while (used.has(id));
  return id;
}

/** Validate/normalise loaded JSON: ensures a title, a nodes array and unique ids. */
function normalize(data) {
  if (!data || !Array.isArray(data.nodes)) throw new Error('roadmap.json needs a "nodes" array');
  const tree = { title: String(data.title || 'Roadmap'), nodes: data.nodes };
  const seen = new Set();
  walk(tree.nodes, (n) => {
    n.label = String(n.label ?? '');
    if (!n.id || seen.has(n.id)) n.id = 'n' + Math.random().toString(36).slice(2, 8);
    seen.add(n.id);
    if (n.status !== undefined && !STATUSES.includes(n.status)) delete n.status;
  });
  return tree;
}

/* =========================================================================
 * 2. Render (pure)
 * ====================================================================== */

const L = {
  row: 30,       // row height
  indent: 24,    // horizontal step per depth level
  padX: 14,      // left padding
  padY: 6,       // top padding
  dotR: 4.5,     // status dot radius
  chevGap: 13,   // dot centre -> chevron centre
  textGap: 24,   // dot centre -> label start
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Flatten the visible part of the tree into rows with coordinates.
 * Collapsed branches hide their descendants.
 */
function layout(tree, collapsed) {
  const rows = [];
  const visit = (nodes, depth, parentRow) => {
    for (const n of nodes) {
      const i = rows.length;
      const row = {
        node: n, depth, parentRow,
        status: statusOf(n),
        kids: hasKids(n),
        open: hasKids(n) && !collapsed.has(n.id),
        x: L.padX + depth * L.indent + L.dotR,
        y: L.padY + i * L.row + L.row / 2,
        lastChildY: null,
      };
      rows.push(row);
      if (row.open) {
        visit(n.children, depth + 1, row);
        row.lastChildY = rows[rows.length - 1 - countTrailing(rows, row)].y;
      }
    }
  };
  // y of the last *direct* child: walk back past the last child's own descendants.
  const countTrailing = (rows, parent) => {
    let k = 0;
    for (let j = rows.length - 1; j >= 0 && rows[j].parentRow !== parent; j--) k++;
    return k;
  };
  visit(tree.nodes, 0, null);
  return rows;
}

/**
 * render(tree, view) -> SVG string.
 * view = { collapsed: Set<id> }. No DOM access, no side effects.
 */
function render(tree, view = {}) {
  const collapsed = view.collapsed || new Set();
  const rows = layout(tree, collapsed);

  // Rough width estimate so long labels aren't clipped (no text measuring here).
  let width = 320;
  for (const r of rows) {
    const w = r.x + L.textGap + r.node.label.length * 8 + (r.node.note ? r.node.note.length * 7 + 14 : 0) + 60;
    if (w > width) width = w;
  }
  const height = L.padY * 2 + rows.length * L.row;

  const lines = [];
  const nodes = [];

  for (const r of rows) {
    // Connectors: a vertical spine under each open parent, a stub to each child.
    if (r.open) {
      lines.push(`<path class="rt-line" d="M${r.x} ${r.y + L.dotR + 3}V${r.lastChildY}"/>`);
    }
    if (r.parentRow) {
      lines.push(`<path class="rt-line" d="M${r.parentRow.x} ${r.y}H${r.x - L.dotR - 4}"/>`);
    }

    const n = r.node;
    const cls = `rt-node s-${r.status}${r.kids ? ' has-kids' : ''}`;
    const tx = r.x + L.textGap;
    const cx = r.x + L.chevGap;
    let g = `<g class="${cls}" data-id="${esc(n.id)}">`;
    g += `<rect class="rt-row" x="0" y="${r.y - L.row / 2}" width="${width}" height="${L.row}" rx="4"/>`;
    if (r.status === 'active') g += `<circle class="rt-pulse" cx="${r.x}" cy="${r.y}" r="${L.dotR}"/>`;
    g += `<circle class="rt-dot" cx="${r.x}" cy="${r.y}" r="${L.dotR}"/>`;
    g += `<circle class="rt-hit" data-action="cycle" cx="${r.x}" cy="${r.y}" r="11"><title>Status: ${r.status} (click to change)</title></circle>`;
    if (r.kids) {
      g += `<rect class="rt-chev-hit" data-action="toggle" x="${cx - 6}" y="${r.y - 8}" width="12" height="16"/>`;
      g += `<path class="rt-chev" d="M-3 -1.5L0 1.5L3 -1.5" transform="translate(${cx} ${r.y}) rotate(${r.open ? 0 : -90})"/>`;
    }
    g += `<text class="rt-text" x="${tx}" y="${r.y}" dy="0.35em">`;
    g += `<tspan class="rt-label" data-action="label">${esc(n.label || '(untitled)')}</tspan>`;
    if (n.note) g += `<tspan class="rt-note" dx="10">${esc(n.note)}</tspan>`;
    g += `<tspan class="rt-act add" data-action="add" dx="12"><title>Add child</title>+</tspan>`;
    g += `<tspan class="rt-act del" data-action="delete" dx="8"><title>Delete</title>×</tspan>`;
    g += `</text></g>`;
    nodes.push(g);
  }

  return `<svg class="rt-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="tree">`
    + `<g class="rt-lines">${lines.join('')}</g>${nodes.join('')}</svg>`;
}

/* =========================================================================
 * 3. App (DOM + persistence)
 * ====================================================================== */

const DRAFT_KEY = 'roadmap-tree:draft';
const VIEW_KEY = 'roadmap-tree:collapsed';

const $ = (id) => document.getElementById(id);

const state = {
  tree: null,
  collapsed: new Set(),
  dirty: false,
  fileHandle: null, // File System Access handle, once the user opens/saves a file
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/** Startup: prefer an unsaved local draft, otherwise fetch roadmap.json. */
async function init() {
  try { state.collapsed = new Set(JSON.parse(store.get(VIEW_KEY) || '[]')); } catch { /* ignore */ }

  const draft = store.get(DRAFT_KEY);
  if (draft) {
    try {
      state.tree = normalize(JSON.parse(draft));
      state.dirty = true;
      toast('Restored unsaved changes');
    } catch { store.del(DRAFT_KEY); }
  }
  if (!state.tree) await loadFromDisk();
  bindEvents();
  update();
}

/** Load the tree from the open file handle, or fetch ./roadmap.json. */
async function loadFromDisk() {
  try {
    let text;
    if (state.fileHandle) text = await (await state.fileHandle.getFile()).text();
    else {
      const res = await fetch('roadmap.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      text = await res.text();
    }
    state.tree = normalize(JSON.parse(text));
    state.dirty = false;
    $('loadError').hidden = true;
  } catch (err) {
    console.warn('Could not load roadmap.json:', err);
    state.tree = state.tree || { title: 'Roadmap', nodes: [] };
    $('loadError').hidden = false;
  }
}

/** Re-render everything from state. The only place that touches the tree DOM. */
function update() {
  const { tree } = state;
  document.title = `${tree.title} · roadmap-tree`;
  $('title').textContent = tree.title;

  $('tree').innerHTML = tree.nodes.length ? render(tree, { collapsed: state.collapsed }) : '';

  const p = progress(tree);
  $('progressFill').style.width = p.pct + '%';
  $('progressText').textContent = `${p.done} / ${p.total} done · ${p.pct}%`;

  renderNext(tree);

  $('saveBtn').classList.toggle('dirty', state.dirty);
  $('saveBtn').textContent = state.dirty ? 'Save •' : 'Save';
  $('discardBtn').hidden = !state.dirty;
}

/** Side panel: active leaves, then the next planned ones. */
function renderNext(tree) {
  const { active, planned } = whatsNext(tree);
  const item = ({ node, path }) =>
    `<li data-id="${esc(node.id)}"><span class="mini-dot s-${statusOf(node)}"></span>`
    + `<span>${esc(node.label)}${path.length ? `<span class="crumb">${esc(path.join(' / '))}</span>` : ''}</span></li>`;
  let html = '<h3>In progress</h3>';
  html += active.length ? `<ul>${active.map(item).join('')}</ul>` : '<p class="none">Nothing active. Click a dot to start something.</p>';
  html += '<h3>Up next</h3>';
  html += planned.length ? `<ul>${planned.map(item).join('')}</ul>` : '<p class="none">Nothing planned.</p>';
  $('nextList').innerHTML = html;
}

/** Apply a data change: mutate, mark dirty, keep a draft, re-render. */
function commit(mutate) {
  mutate(state.tree);
  state.dirty = true;
  store.set(DRAFT_KEY, JSON.stringify(state.tree));
  update();
}

function saveView() {
  store.set(VIEW_KEY, JSON.stringify([...state.collapsed]));
}

function toggleBranch(id) {
  if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
  saveView();
  update();
}

/** Expand every ancestor of `id` so it becomes visible. */
function reveal(id) {
  const walkUp = (nodes, trail) => {
    for (const n of nodes) {
      if (n.id === id) { trail.forEach((a) => state.collapsed.delete(a)); return true; }
      if (hasKids(n) && walkUp(n.children, trail.concat(n.id))) return true;
    }
    return false;
  };
  walkUp(state.tree.nodes, []);
  saveView();
}

/** Delegated clicks on the tree. */
let labelClickTimer = null;

function onTreeClick(e) {
  const target = e.target.closest('[data-action]');
  const g = e.target.closest('.rt-node');
  if (!target || !g) return;
  const id = g.dataset.id;
  const hit = findNode(state.tree, id);
  if (!hit) return;

  switch (target.dataset.action) {
    case 'cycle':
      commit(() => { hit.node.status = nextStatus(statusOf(hit.node)); });
      break;
    case 'toggle':
      toggleBranch(id);
      break;
    case 'label':
      // Delay so a double-click (rename) doesn't also toggle.
      if (!hasKids(hit.node)) return;
      clearTimeout(labelClickTimer);
      labelClickTimer = setTimeout(() => toggleBranch(id), 230);
      break;
    case 'add': {
      const child = { id: newId(state.tree), label: 'New item', status: 'planned' };
      state.collapsed.delete(id);
      saveView();
      commit(() => { (hit.node.children ||= []).push(child); });
      startRename(child.id, true);
      break;
    }
    case 'delete': {
      const n = hit.node;
      const extra = hasKids(n) ? ' and everything under it' : '';
      if (!confirm(`Delete "${n.label}"${extra}?`)) return;
      commit(() => { hit.siblings.splice(hit.siblings.indexOf(n), 1); });
      break;
    }
  }
}

function onTreeDblClick(e) {
  if (!e.target.closest('[data-action="label"]')) return;
  clearTimeout(labelClickTimer);
  const g = e.target.closest('.rt-node');
  if (g) startRename(g.dataset.id);
}

/** Overlay an <input> on a label to rename it. Enter/blur saves, Esc cancels. */
function startRename(id, selectAll = false) {
  const wrap = $('treeWrap');
  const g = wrap.querySelector(`.rt-node[data-id="${CSS.escape(id)}"]`);
  const hit = findNode(state.tree, id);
  if (!g || !hit) return;
  const label = g.querySelector('.rt-label');
  const lr = label.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();

  const input = document.createElement('input');
  input.className = 'rename';
  input.value = hit.node.label;
  input.style.left = lr.left - wr.left + wrap.scrollLeft + 'px';
  input.style.top = lr.top - wr.top + wrap.scrollTop + 'px';
  input.style.width = Math.max(160, lr.width + 40) + 'px';
  wrap.appendChild(input);
  input.focus();
  if (selectAll) input.select();

  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.remove();
    if (keep && v && v !== hit.node.label) commit(() => { hit.node.label = v; });
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

/** Save: File System Access API when available, otherwise download a file. */
async function save() {
  const text = JSON.stringify(state.tree, null, 2) + '\n';

  if (window.showSaveFilePicker) {
    try {
      if (!state.fileHandle) {
        state.fileHandle = await window.showSaveFilePicker({
          suggestedName: 'roadmap.json',
          types: [{ description: 'Roadmap JSON', accept: { 'application/json': ['.json'] } }],
        });
      }
      const w = await state.fileHandle.createWritable();
      await w.write(text);
      await w.close();
      markSaved(`Saved to ${state.fileHandle.name}`);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled the picker
      console.warn('File System Access save failed, falling back to download:', err);
      state.fileHandle = null;
    }
  }

  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'roadmap.json' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markSaved('Downloaded roadmap.json — replace the project copy with it');
}

function markSaved(msg) {
  state.dirty = false;
  store.del(DRAFT_KEY);
  update();
  toast(msg);
}

/** Open a roadmap.json via the file picker (keeps the handle so Save writes back silently). */
async function openFile() {
  try {
    let text;
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Roadmap JSON', accept: { 'application/json': ['.json'] } }],
      });
      state.fileHandle = handle;
      text = await (await handle.getFile()).text();
    } else {
      text = await pickFileFallback();
      if (text == null) return;
    }
    if (state.dirty && !confirm('Discard unsaved changes and open this file?')) return;
    state.tree = normalize(JSON.parse(text));
    state.dirty = false;
    store.del(DRAFT_KEY);
    $('loadError').hidden = true;
    update();
    toast('Opened');
  } catch (err) {
    if (err.name === 'AbortError') return;
    alert('Could not open file: ' + err.message);
  }
}

function pickFileFallback() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => resolve(input.files[0] ? await input.files[0].text() : null);
    input.click();
  });
}

async function discard() {
  if (!confirm('Drop all unsaved changes and reload roadmap.json?')) return;
  store.del(DRAFT_KEY);
  await loadFromDisk();
  update();
  toast('Reloaded from disk');
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function bindEvents() {
  const tree = $('tree');
  tree.addEventListener('click', onTreeClick);
  tree.addEventListener('dblclick', onTreeDblClick);

  $('expandAll').onclick = () => { state.collapsed.clear(); saveView(); update(); };
  $('collapseAll').onclick = () => { state.collapsed = new Set(branchIds(state.tree)); saveView(); update(); };
  $('saveBtn').onclick = save;
  $('openBtn').onclick = openFile;
  $('discardBtn').onclick = discard;

  // Clicking an item in "What's next" reveals and highlights it in the tree.
  $('nextList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    reveal(li.dataset.id);
    update();
    const g = $('tree').querySelector(`.rt-node[data-id="${CSS.escape(li.dataset.id)}"]`);
    if (!g) return;
    g.scrollIntoView({ block: 'center', behavior: 'smooth' });
    g.classList.add('flash');
    setTimeout(() => g.classList.remove('flash'), 1200);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
}

init();
