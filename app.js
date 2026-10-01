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
  const hasActiveBelow = (n) => hasKids(n) && n.children.some((c) => c.status === 'active' || hasActiveBelow(c));
  walk(tree.nodes, (n, _d, _p, path) => {
    if (n.status === 'active' && !hasActiveBelow(n)) active.push({ node: n, path });
  });
  const planned = leaves(tree).filter((l) => statusOf(l.node) === 'planned').slice(0, limit);
  return { active, planned };
}

/** True if `id` is `node` itself or anywhere beneath it. */
function containsId(node, id) {
  return node.id === id || (hasKids(node) && node.children.some((c) => containsId(c, id)));
}

/**
 * Move node `id` relative to node `targetId`: pos is 'before', 'after'
 * (as a sibling) or 'inside' (as the target's last child). Returns false,
 * changing nothing, if the move is impossible (onto itself or its own subtree).
 */
function moveNode(tree, id, targetId, pos) {
  const src = findNode(tree, id);
  const dst = findNode(tree, targetId);
  if (!src || !dst || containsId(src.node, targetId)) return false;
  src.siblings.splice(src.siblings.indexOf(src.node), 1);
  if (pos === 'inside') (dst.node.children ||= []).push(src.node);
  else {
    const i = dst.siblings.indexOf(dst.node); // index after the removal above
    dst.siblings.splice(pos === 'before' ? i : i + 1, 0, src.node);
  }
  return true;
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
  const tree = { id: String(data.id || newProjectId()), title: String(data.title || 'Roadmap'), nodes: data.nodes, log: [] };
  // Time log: [{ id, node, label, start, end }] with epoch-ms start/end.
  if (Array.isArray(data.log)) {
    tree.log = data.log.filter((e) => e && typeof e.node === 'string' && e.start < e.end)
      .map((e) => ({ id: e.id || newLogId(), node: e.node, label: String(e.label ?? ''), start: +e.start, end: +e.end }));
  }
  const seen = new Set();
  walk(tree.nodes, (n) => {
    n.label = String(n.label ?? '');
    if (!n.id || seen.has(n.id)) n.id = 'n' + Math.random().toString(36).slice(2, 8);
    seen.add(n.id);
    if (n.status !== undefined && !STATUSES.includes(n.status)) delete n.status;
    if (n.due !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(n.due)) delete n.due; // target date, 'YYYY-MM-DD'
  });
  return tree;
}

const newProjectId = () => 'p' + Math.random().toString(36).slice(2, 8);

/**
 * Load a file's contents as a set of projects. Accepts either a single
 * project ({ title, nodes, log }) or a workspace
 * ({ projects: [...], active: id }). Returns { projects, active }.
 */
function normalizeWorkspace(data) {
  const list = data && Array.isArray(data.projects) ? data.projects : [data];
  if (!list.length) throw new Error('File has no projects');
  const projects = list.map(normalize);
  const ids = new Set();
  for (const p of projects) {
    if (ids.has(p.id)) p.id = newProjectId();
    ids.add(p.id);
  }
  const active = projects.find((p) => p.id === (data && data.active)) || projects[0];
  return { projects, active };
}

/** Map of 'YYYY-MM-DD' -> nodes whose target date is that day. */
function dueByDay(tree) {
  const m = new Map();
  walk(tree.nodes, (n) => { if (n.due) m.set(n.due, (m.get(n.due) || []).concat(n)); });
  return m;
}

/** "Oct 5" for a 'YYYY-MM-DD' target date. */
function fmtDue(key) {
  return new Date(dayStart(key)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---- time log helpers (epoch-ms entries, local-time days) ---- */

const MIN = 60000;
const pad2 = (n) => String(n).padStart(2, '0');
const newLogId = () => 'e' + Math.random().toString(36).slice(2, 9);

/** 'YYYY-MM-DD' in local time. */
const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Local midnight (epoch ms) that starts the day `key`. */
const dayStart = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** Local midnight following the moment `t`. */
const nextMidnight = (t) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};

/** Split one entry at midnights: [{ day, ms }]. */
function splitByDay(e) {
  const out = [];
  for (let t = e.start; t < e.end;) {
    const stop = Math.min(nextMidnight(t), e.end);
    out.push({ day: dayKey(t), ms: stop - t });
    t = stop;
  }
  return out;
}

/** Map of 'YYYY-MM-DD' -> total ms tracked that day. */
function totalsByDay(log) {
  const m = new Map();
  for (const e of log) for (const p of splitByDay(e)) m.set(p.day, (m.get(p.day) || 0) + p.ms);
  return m;
}

/** Entries touching one day, clipped to it: [{ entry, from, to }], earliest first. */
function dayEntries(log, key) {
  const a = dayStart(key);
  const b = nextMidnight(a);
  return log
    .filter((e) => e.start < b && e.end > a)
    .map((entry) => ({ entry, from: Math.max(entry.start, a), to: Math.min(entry.end, b) }))
    .sort((x, y) => x.from - y.from);
}

/** Map of node id -> ms tracked, with each branch including its descendants. */
function spentByNode(tree) {
  const own = new Map();
  for (const e of tree.log) own.set(e.node, (own.get(e.node) || 0) + (e.end - e.start));
  const spent = new Map();
  const sum = (n) => {
    let t = own.get(n.id) || 0;
    if (hasKids(n)) for (const c of n.children) t += sum(c);
    spent.set(n.id, t);
    return t;
  };
  tree.nodes.forEach(sum);
  return spent;
}

/** Total ms tracked within a calendar month (month is 0-based). */
function monthTotal(log, year, month) {
  const prefix = `${year}-${pad2(month + 1)}-`;
  let t = 0;
  for (const [k, ms] of totalsByDay(log)) if (k.startsWith(prefix)) t += ms;
  return t;
}

/** "2h 10m", "45m", "<1m". */
function fmtDur(ms) {
  const m = Math.round(ms / MIN);
  if (m < 1) return ms > 0 ? '<1m' : '0m';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${m}m`;
}

/** "01:02:03" for the running timer. */
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
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
    const w = r.x + L.textGap + r.node.label.length * 8 + (r.node.note ? r.node.note.length * 7 + 14 : 0) + (r.node.due ? 100 : 0) + 60;
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
    const isRunning = view.running === n.id;
    const spentMs = view.spent ? view.spent.get(n.id) || 0 : 0;
    const cls = `rt-node s-${r.status}${r.kids ? ' has-kids' : ''}${isRunning ? ' running' : ''}${view.selected === n.id ? ' selected' : ''}`;
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
    if (n.md) g += `<tspan class="rt-hasnote" dx="8"><title>Has notes</title>¶</tspan>`;
    if (n.note) g += `<tspan class="rt-note" dx="10">${esc(n.note)}</tspan>`;
    if (spentMs >= MIN / 2) g += `<tspan class="rt-note rt-spent" dx="10">${fmtDur(spentMs)}</tspan>`;
    if (n.due) {
      const overdue = view.today && n.due < view.today && r.status !== 'done';
      g += `<tspan class="rt-note rt-due${overdue ? ' overdue' : ''}" dx="10">target ${esc(fmtDue(n.due))}</tspan>`;
    }
    g += `<tspan class="rt-act grip" data-action="grip" dx="12"><title>Drag to move</title>≡</tspan>`;
    g += `<tspan class="rt-act" data-action="up" dx="6"><title>Move up</title>↑</tspan>`;
    g += `<tspan class="rt-act" data-action="down" dx="4"><title>Move down</title>↓</tspan>`;
    g += `<tspan class="rt-act play" data-action="timer" dx="8">${isRunning ? '■' : '▶'}</tspan>`;
    g += `<tspan class="rt-act add" data-action="add" dx="8"><title>Add child</title>+</tspan>`;
    g += `<tspan class="rt-act del" data-action="delete" dx="8"><title>Delete</title>×</tspan>`;
    g += `</text></g>`;
    nodes.push(g);
  }

  return `<svg class="rt-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="tree">`
    + `<g class="rt-lines">${lines.join('')}</g>${nodes.join('')}</svg>`;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Label for a log entry: the live node's label, else the snapshot taken when logged. */
function entryLabel(tree, e) {
  const hit = findNode(tree, e.node);
  return hit ? hit.node.label : e.label || '(deleted item)';
}

/**
 * renderCalendar(tree, view) -> HTML for a Monday-first month grid.
 * view = { year, month (0-based), selected, today } with day keys 'YYYY-MM-DD'.
 * Each cell shows the day number and time tracked, shaded by amount.
 */
function renderCalendar(tree, view) {
  const totals = totalsByDay(tree.log);
  const dues = dueByDay(tree);
  const lead = (new Date(view.year, view.month, 1).getDay() + 6) % 7;
  const days = new Date(view.year, view.month + 1, 0).getDate();
  const rows = Math.ceil((lead + days) / 7);

  let html = WEEKDAYS.map((d) => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(view.year, view.month, 1 - lead + i);
    const key = dayKey(d);
    const ms = totals.get(key) || 0;
    const lv = !ms ? 0 : ms < 30 * MIN ? 1 : ms < 60 * MIN ? 2 : ms < 120 * MIN ? 3 : 4;
    const cls = `cal-cell lv${lv}`
      + (d.getMonth() !== view.month ? ' other' : '')
      + (key === view.today ? ' today' : '')
      + (key === view.selected ? ' sel' : '');
    // Target marker: "⚑ n" for steps due that day; red if any is unfinished and the day has passed.
    const due = dues.get(key) || [];
    const late = due.some((n) => statusOf(n) !== 'done') && view.today && key < view.today;
    const badge = due.length ? `<span class="cal-due${late ? ' overdue' : ''}" title="${due.length} target${due.length > 1 ? 's' : ''}">⚑ ${due.length}</span>` : '';
    html += `<button type="button" class="${cls}" data-action="day" data-day="${key}">`
      + `<span class="cal-top"><span class="cal-num">${d.getDate()}</span>${badge}</span>`
      + `${ms ? `<span class="cal-dur">${fmtDur(ms)}</span>` : ''}</button>`;
  }
  return html;
}

/**
 * renderDay(tree, key) -> HTML detail for one day: per-task totals, the
 * individual sessions (each deletable), and a form to add time by hand.
 */
function renderDay(tree, key) {
  const rows = dayEntries(tree.log, key);
  const byNode = new Map();
  for (const r of rows) {
    const cur = byNode.get(r.entry.node) || { label: entryLabel(tree, r.entry), ms: 0 };
    cur.ms += r.to - r.from;
    byNode.set(r.entry.node, cur);
  }
  const total = [...byNode.values()].reduce((a, b) => a + b.ms, 0);
  const title = new Date(dayStart(key)).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  let html = `<h3>${esc(title)}<span class="day-total">${total ? fmtDur(total) : ''}</span></h3>`;
  if (!rows.length) html += '<p class="none">Nothing tracked this day.</p>';
  else {
    html += '<ul class="day-tasks">' + [...byNode.values()].sort((a, b) => b.ms - a.ms)
      .map((t) => `<li><span class="lbl">${esc(t.label)}</span><span class="dur">${fmtDur(t.ms)}</span></li>`).join('') + '</ul>';
    html += '<h4>Sessions</h4><ul class="day-sessions">' + rows.map((r) =>
      `<li><span class="t">${fmtTime(r.from)}–${fmtTime(r.to)}</span><span class="lbl">${esc(entryLabel(tree, r.entry))}</span>`
      + `<span class="dur">${fmtDur(r.to - r.from)}</span>`
      + `<button type="button" class="x" data-action="del-entry" data-eid="${esc(r.entry.id)}" title="Delete session">×</button></li>`).join('') + '</ul>';
  }

  const options = [];
  walk(tree.nodes, (n, depth) => options.push(`<option value="${esc(n.id)}">${'  '.repeat(depth)}${esc(n.label)}</option>`));
  // Targets: steps due this day, plus a form to set a target date on any step.
  const due = dueByDay(tree).get(key) || [];
  html += '<h4>Targets</h4>';
  html += due.length
    ? '<ul class="day-due">' + due.map((n) => `<li class="${statusOf(n) === 'done' ? 'done' : ''}">`
      + `<span class="mini-dot s-${statusOf(n)}"></span><span class="lbl">${esc(n.label)}</span>`
      + `<button type="button" class="x" data-action="del-due" data-id="${esc(n.id)}" title="Remove target">×</button></li>`).join('') + '</ul>'
    : '<p class="none">No targets this day.</p>';
  if (options.length) {
    html += `<form class="manual due" data-day="${key}"><select name="node">${options.join('')}</select>`
      + `<button type="submit">Set target</button></form>`;
  }

  if (options.length) {
    html += `<form class="manual time" data-day="${key}"><h4>Add time manually</h4>`
      + `<select name="node">${options.join('')}</select>`
      + `<input name="min" type="number" min="1" max="1440" placeholder="minutes" required>`
      + `<button type="submit">Add</button></form>`;
  }
  return html;
}

/* =========================================================================
 * 3. App (DOM + persistence)
 * ====================================================================== */

const DRAFT_KEY = 'roadmap-tree:draft';
const VIEW_KEY = 'roadmap-tree:collapsed';

const $ = (id) => document.getElementById(id);

const IS_DESKTOP = navigator.userAgent.includes('Electron'); // packaged app, see desktop/main.js
let appVersion = null; // set from the desktop app's version.json
const TIMER_KEY = 'roadmap-tree:timer';
const TAB_KEY = 'roadmap-tree:tab';

const now = new Date();

const state = {
  projects: [],     // every project (each is a tree: { id, title, nodes, log })
  tree: null,       // the active project, one of `projects`
  collapsed: new Set(),
  dirty: false,
  fileHandle: null, // File System Access handle, once the user saves to a chosen file (browser only)
  timer: null,      // running timer: { projectId, nodeId, label, start }; survives reloads via localStorage
  tab: 'tree',      // 'tree' | 'calendar'
  selected: null,   // id of the step whose notes are open
  noteMode: 'view', // 'view' | 'edit'
  cal: { year: now.getFullYear(), month: now.getMonth(), selected: dayKey(now) },
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/** Startup: prefer an unsaved local draft, otherwise fetch roadmap.json. */
async function init() {
  try { state.collapsed = new Set(JSON.parse(store.get(VIEW_KEY) || '[]')); } catch { /* ignore */ }
  try { state.timer = JSON.parse(store.get(TIMER_KEY) || 'null'); } catch { /* ignore */ }
  if (store.get(TAB_KEY) === 'calendar') state.tab = 'calendar';

  const draft = store.get(DRAFT_KEY);
  if (draft) {
    try {
      setWorkspace(normalizeWorkspace(JSON.parse(draft)));
      state.dirty = true;
      toast('Restored unsaved changes');
    } catch { store.del(DRAFT_KEY); }
  }
  if (!state.tree) await loadFromDisk();
  if (state.timer && !state.timer.projectId) state.timer.projectId = state.tree.id; // timers from older versions
  bindEvents();
  update();
}

/** Make `{ projects, active }` (from normalizeWorkspace) the current state. */
function setWorkspace(ws) {
  state.projects = ws.projects;
  state.tree = ws.active;
  state.selected = null;
}

/** What gets written to disk: a lone project as-is (opens anywhere), several as a workspace. */
function fileDoc() {
  return state.projects.length === 1
    ? state.projects[0]
    : { version: 2, active: state.tree.id, projects: state.projects };
}

/** What the localStorage draft holds: always the whole workspace. */
function draftDoc() {
  return { version: 2, active: state.tree.id, projects: state.projects };
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
    setWorkspace(normalizeWorkspace(JSON.parse(text)));
    state.dirty = false;
    $('loadError').hidden = true;
  } catch (err) {
    console.warn('Could not load roadmap.json:', err);
    if (!state.tree) setWorkspace(normalizeWorkspace({ title: 'Roadmap', nodes: [] }));
    $('loadError').hidden = false;
  }
}

/** Re-render everything from state. The only place that touches the tree DOM. */
function update() {
  const { tree } = state;
  document.title = `${tree.title} · roadmap-tree`;
  $('title').textContent = tree.title;

  const running = state.timer && state.timer.projectId === tree.id ? state.timer.nodeId : null;
  $('tree').innerHTML = tree.nodes.length
    ? render(tree, { collapsed: state.collapsed, running, spent: spentByNode(tree), selected: state.selected, today: dayKey(Date.now()) })
    : '';
  renderTabs();

  $('emptyState').hidden = tree.nodes.length > 0 || !$('loadError').hidden;

  // Tabs: only the active view is shown; tree-only buttons hide on the calendar.
  const cal = state.tab === 'calendar';
  $('treeWrap').hidden = cal;
  $('calWrap').hidden = !cal;
  $('treeActions').hidden = cal;
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  if (cal) renderCal();
  tickTimer();
  refreshTip();

  const p = progress(tree);
  $('progressFill').style.width = p.pct + '%';
  $('progressText').textContent = `${p.done} / ${p.total} done · ${p.pct}%`;

  renderNext(tree);
  renderNotePane();
  updateSaveState();

  // Tracked time (all projects) feeds the aquarium's "every 30 min = 1 pearl" quest.
  let tracked = 0;
  for (const proj of state.projects) for (const e of proj.log) tracked += e.end - e.start;
  Aquarium.trackedTime(tracked);
}

/** Save button shows a dot (and Discard appears) while there are unsaved changes. */
function updateSaveState() {
  $('saveBtn').classList.toggle('dirty', state.dirty);
  $('saveBtn').textContent = state.dirty ? 'Save •' : 'Save';
  $('discardBtn').hidden = !state.dirty;
}

/* ---- step notes ---- */

/** Open (or keep open) the notes of a step. A step without notes opens in edit mode. */
function selectNode(id) {
  if (state.selected === id) return;
  const hit = findNode(state.tree, id);
  if (!hit) return;
  state.selected = id;
  state.noteMode = hit.node.md ? 'view' : 'edit';
  update();
  if (state.noteMode === 'edit') $('noteText').focus();
}

function closeNote() {
  state.selected = null;
  update();
}

/** Show/hide the notes pane for the selected step and sync its contents. */
function renderNotePane() {
  const hit = state.selected ? findNode(state.tree, state.selected) : null;
  if (!hit) state.selected = null; // the step was deleted or the tree was replaced
  const show = !!hit && state.tab === 'tree';
  $('notePane').hidden = !show;
  $('mainLayout').classList.toggle('has-note', show);
  if (!show) return;

  let crumb = '';
  walk(state.tree.nodes, (n, _d, _p, path) => { if (n.id === hit.node.id) crumb = path.join(' / '); });
  $('noteTitle').textContent = hit.node.label || '(untitled)';
  $('noteCrumb').textContent = crumb;
  if (document.activeElement !== $('noteDue')) $('noteDue').value = hit.node.due || '';

  const editing = state.noteMode === 'edit';
  $('notePane').classList.toggle('editing', editing);
  $('noteEdit').textContent = editing ? 'Done' : 'Edit';

  // Don't overwrite what the user is typing; otherwise load the step's text.
  const ta = $('noteText');
  if (document.activeElement !== ta) ta.value = hit.node.md || '';
  drawNotePreview(hit.node);
}

/** Render the step's Markdown (and LaTeX) into the preview. */
function drawNotePreview(node) {
  const view = $('noteView');
  view.innerHTML = node.md
    ? renderMarkdown(node.md)
    : '<p class="none">No notes yet. Click <strong>Edit</strong> to write some. Markdown and LaTeX are supported, e.g. <code>$E = mc^2$</code>.</p>';
  view.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
}

/** Redraw the calendar grid, month header and selected-day detail. */
function renderCal() {
  const { year, month, selected } = state.cal;
  $('calTitle').textContent = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('calTotal').textContent = `${fmtDur(monthTotal(state.tree.log, year, month))} this month`;
  $('calGrid').innerHTML = renderCalendar(state.tree, { year, month, selected, today: dayKey(Date.now()) });
  $('calDay').innerHTML = renderDay(state.tree, selected);
}

function setTab(tab) {
  state.tab = tab;
  store.set(TAB_KEY, tab);
  update();
}

function shiftMonth(delta) {
  const d = new Date(state.cal.year, state.cal.month + delta, 1);
  state.cal.year = d.getFullYear();
  state.cal.month = d.getMonth();
  renderCal();
}

/* ---- timer ---- */

/** Start timing a node. Any running timer is stopped (and logged) first. */
function startTimer(id) {
  const hit = findNode(state.tree, id);
  if (!hit) return;
  if (state.timer) stopTimer();
  state.timer = { projectId: state.tree.id, nodeId: id, label: hit.node.label, start: Date.now() };
  store.set(TIMER_KEY, JSON.stringify(state.timer));
  // Working on something means it's in progress.
  if (statusOf(hit.node) === 'planned') commit(() => { hit.node.status = 'active'; });
  else update();
}

/** Stop the running timer and log the session (sessions under 1s are dropped). */
function stopTimer() {
  const t = state.timer;
  if (!t) return;
  state.timer = null;
  store.del(TIMER_KEY);
  const end = Date.now();
  // The session belongs to the project the timer was started in, even if another tab is open now.
  const owner = state.projects.find((p) => p.id === t.projectId);
  if (owner && end - t.start >= 1000) {
    const hit = findNode(owner, t.nodeId);
    commit((tree) => tree.log.push({ id: newLogId(), node: t.nodeId, label: hit ? hit.node.label : t.label, start: t.start, end }), owner);
  } else update();
}

/** Once a second: keep the window title and any open hover tip ticking (no re-render). */
function tickTimer() {
  const t = state.timer;
  document.title = t
    ? `● ${fmtClock(Date.now() - t.start)} · ${t.label}`
    : `${state.tree.title} · roadmap-tree`;
  fillTip();
}

/* ---- timer hover tip: shows the running time (or time tracked) next to the ▶ / ■ button ---- */

let tipTarget = null; // { id } of the step whose timer button is hovered

function tipText(id) {
  const t = state.timer;
  const spent = spentByNode(state.tree).get(id) || 0;
  if (t && t.projectId === state.tree.id && t.nodeId === id) {
    return `Running ${fmtClock(Date.now() - t.start)}` + (spent >= MIN ? ` · ${fmtDur(spent)} before` : '') + ' · click to stop';
  }
  return spent >= MIN ? `${fmtDur(spent)} tracked · click to start` : 'Click to start the timer';
}

/** Update the tip's text and position beside its button (hides it if the button is gone). */
function fillTip() {
  const tip = $('tip');
  const el = tipTarget && $('tree').querySelector(`.rt-node[data-id="${CSS.escape(tipTarget.id)}"] [data-action="timer"]`);
  if (!el) { tip.hidden = true; return; }
  tip.textContent = tipText(tipTarget.id);
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(r.left - 8, innerWidth - tip.offsetWidth - 8)) + 'px';
  tip.style.top = Math.max(8, r.top - tip.offsetHeight - 6) + 'px';
}

/** After a re-render the pointer may no longer be over the button; drop the tip unless it is. */
function refreshTip() {
  if (!tipTarget) return;
  requestAnimationFrame(() => {
    const el = $('tree').querySelector(`.rt-node[data-id="${CSS.escape(tipTarget.id)}"] [data-action="timer"]`);
    if (el && el.matches(':hover')) fillTip(); else { tipTarget = null; $('tip').hidden = true; }
  });
}

/** Side panel: active leaves, then the next planned ones. */
function renderNext(tree) {
  const { active, planned } = whatsNext(tree);
  const item = ({ node, path }) =>
    `<li data-id="${esc(node.id)}"><span class="mini-dot s-${statusOf(node)}"></span>`
    + `<span>${esc(node.label)}${path.length || node.due ? `<span class="crumb">${esc(path.join(' / '))}${node.due ? `${path.length ? ' · ' : ''}target ${esc(fmtDue(node.due))}` : ''}</span>` : ''}</span></li>`;
  let html = '<h3>In progress</h3>';
  html += active.length ? `<ul>${active.map(item).join('')}</ul>` : '<p class="none">Nothing active. Click a dot to start something.</p>';
  html += '<h3>Up next</h3>';
  html += planned.length ? `<ul>${planned.map(item).join('')}</ul>` : '<p class="none">Nothing planned.</p>';
  $('nextList').innerHTML = html;
}

/** Apply a data change: mutate, mark dirty, keep a draft, re-render. */
function commit(mutate, tree = state.tree) {
  mutate(tree);
  markDirty();
  update();
}

/** Flag unsaved changes and keep the draft in localStorage. */
function markDirty() {
  state.dirty = true;
  store.set(DRAFT_KEY, JSON.stringify(draftDoc()));
}

/* ---- projects (tabs) ---- */

/** Draw the project tabs; a green dot marks the project with a running timer. */
function renderTabs() {
  const t = state.timer;
  $('projectTabs').innerHTML = state.projects.map((p) =>
    `<button type="button" class="ptab${p.id === state.tree.id ? ' on' : ''}" data-pid="${esc(p.id)}" title="Double-click to rename">`
    + (t && t.projectId === p.id ? '<span class="tdot" title="Timer running"></span>' : '')
    + `<span class="ptitle">${esc(p.title || 'Untitled')}</span>`
    + `<span class="pclose" data-close="${esc(p.id)}" title="Delete this project">×</span></button>`).join('')
    + '<button type="button" class="ptab-add" id="addProject" title="New project">+</button>';
}

function switchProject(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p || p === state.tree) return;
  state.tree = p;
  state.selected = null;
  update();
}

/** New empty project; its title opens for renaming straight away. */
function addProject() {
  const p = { id: newProjectId(), title: `Project ${state.projects.length + 1}`, nodes: [], log: [] };
  state.projects.push(p);
  state.tree = p;
  state.selected = null;
  markDirty();
  update();
  startTitleEdit();
}

/** Delete a project and everything in it, after confirmation. At least one always remains. */
function closeProject(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  if (state.projects.length === 1) { toast('Keep at least one project.'); return; }
  if (!confirm(`Delete the project "${p.title}" with all its steps, notes and tracked time?\n\nUse "Save as…" first if you want a copy.`)) return;
  if (state.timer && state.timer.projectId === id) stopTimer();
  const i = state.projects.indexOf(p);
  state.projects.splice(i, 1);
  if (state.tree === p) { state.tree = state.projects[Math.min(i, state.projects.length - 1)]; state.selected = null; }
  markDirty();
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
    case 'cycle': {
      const to = nextStatus(statusOf(hit.node));
      commit(() => { hit.node.status = to; });
      if (to === 'done') Aquarium.stepDone(`${state.tree.id}:${id}`); // quest reward, once per step
      break;
    }
    case 'toggle':
      toggleBranch(id);
      break;
    case 'timer':
      if (state.timer && state.timer.projectId === state.tree.id && state.timer.nodeId === id) stopTimer(); else startTimer(id);
      break;
    case 'up':
    case 'down': {
      // Swap with the neighbouring sibling.
      const i = hit.siblings.indexOf(hit.node);
      const j = i + (target.dataset.action === 'up' ? -1 : 1);
      if (j < 0 || j >= hit.siblings.length) { toast(j < 0 ? 'Already first here.' : 'Already last here.'); return; }
      commit(() => { [hit.siblings[i], hit.siblings[j]] = [hit.siblings[j], hit.siblings[i]]; });
      break;
    }
    case 'label':
      // Click opens the step's notes. Delayed so a double-click (rename) doesn't also open them.
      clearTimeout(labelClickTimer);
      labelClickTimer = setTimeout(() => selectNode(id), 230);
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
      if (state.timer && state.timer.projectId === state.tree.id && state.timer.nodeId === id) stopTimer();
      if (state.selected && containsId(n, state.selected)) state.selected = null;
      commit(() => { hit.siblings.splice(hit.siblings.indexOf(n), 1); });
      break;
    }
  }
}

/**
 * Drag a step by its ≡ handle. Dropping on the top/bottom edge of another
 * row puts it before/after that row; dropping on the middle makes it a child.
 */
function startDrag(e, srcId, immediate) {
  const wrap = $('treeWrap');
  const srcNode = findNode(state.tree, srcId).node;
  const srcG = wrap.querySelector(`.rt-node[data-id="${CSS.escape(srcId)}"]`);
  const x0 = e.clientX;
  const y0 = e.clientY;
  let ind = null;
  let active = false; // false until the pointer has moved enough to count as a drag
  let drop = null;

  const begin = () => {
    active = true;
    ind = document.createElement('div');
    ind.className = 'drop-ind';
    ind.hidden = true;
    wrap.appendChild(ind);
    srcG.classList.add('dragging');
    document.body.classList.add('is-dragging');
  };
  if (immediate) { e.preventDefault(); begin(); }

  const targetAt = (ev) => {
    for (const g of wrap.querySelectorAll('.rt-node')) {
      const r = g.querySelector('.rt-row').getBoundingClientRect();
      if (ev.clientY < r.top || ev.clientY >= r.bottom) continue;
      if (containsId(srcNode, g.dataset.id)) return null; // not onto itself or its own children
      const f = (ev.clientY - r.top) / r.height;
      return { id: g.dataset.id, pos: f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'inside', r, g };
    }
    return null;
  };

  const onMove = (ev) => {
    if (!active) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return; // still just a click
      begin();
    }
    const wr = wrap.getBoundingClientRect();
    if (ev.clientY < wr.top + 30) wrap.scrollTop -= 12; // scroll while dragging near the edges
    else if (ev.clientY > wr.bottom - 30) wrap.scrollTop += 12;
    drop = targetAt(ev);
    ind.hidden = !drop;
    if (!drop) return;
    const left = drop.g.querySelector('.rt-dot').getBoundingClientRect().left - wr.left + wrap.scrollLeft - 6;
    const y = (drop.pos === 'after' ? drop.r.bottom : drop.r.top) - wr.top + wrap.scrollTop;
    ind.className = 'drop-ind ' + drop.pos;
    ind.style.left = left + 'px';
    ind.style.top = (drop.pos === 'inside' ? drop.r.top - wr.top + wrap.scrollTop : y - 1) + 'px';
    ind.style.height = drop.pos === 'inside' ? drop.r.height + 'px' : '2px';
    ind.style.width = Math.max(120, wr.width - left - 24) + 'px';
  };

  const end = (keep) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
    if (!active) return; // never moved: let the click through
    ind.remove();
    srcG.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    // Swallow the click the browser fires after the drop so it doesn't toggle or open anything.
    const swallow = (ev) => ev.stopPropagation();
    document.addEventListener('click', swallow, true);
    setTimeout(() => document.removeEventListener('click', swallow, true), 60);
    if (!keep || !drop) return;
    const { id, pos } = drop;
    if (pos === 'inside') { state.collapsed.delete(id); saveView(); }
    commit((tree) => { moveNode(tree, srcId, id, pos); });
  };
  const onUp = () => end(true);
  const onKey = (ev) => { if (ev.key === 'Escape') end(false); };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', onKey);
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

const JSON_TYPES = [{ description: 'Roadmap JSON', accept: { 'application/json': ['.json'] } }];

/** Trigger a browser download (the desktop app shows its own Save dialog for this). */
function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * "Save as…": write the open project to a file you choose, as a standalone
 * .json you can keep, share, or Import on another PC. Leaves the app's own
 * data and the unsaved-changes state alone.
 */
async function saveAs() {
  const t = state.tree;
  const text = JSON.stringify(t, null, 2) + '\n';
  const name = (t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'roadmap') + '.json';
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, types: JSON_TYPES });
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      toast(`Saved a copy to ${h.name}`);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // cancelled
      console.warn('File picker failed, falling back to download:', err);
    }
  }
  downloadText(text, name);
  toast(`Saved ${name}`);
}

/** Save: the desktop app writes its data file; browsers write the chosen file, or download. */
async function save() {
  const text = JSON.stringify(fileDoc(), null, 2) + '\n';

  // Desktop app: its built-in server writes straight to the app-data file.
  if (IS_DESKTOP) {
    try {
      const res = await fetch('roadmap.json', { method: 'PUT', body: text });
      if (!res.ok) throw new Error(res.status);
      markSaved('Saved');
    } catch (err) { alert('Could not save: ' + err.message); }
    return;
  }

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

  downloadText(text, 'roadmap.json');
  markSaved('Downloaded roadmap.json — replace the project copy with it');
}

function markSaved(msg) {
  state.dirty = false;
  store.del(DRAFT_KEY);
  update();
  toast(msg);
}

/**
 * Import a .json file as a new project tab (a file with several projects adds
 * them all). Works with files made by "Save as…" or the older single roadmap.json.
 */
async function importFile() {
  try {
    let text;
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({ types: JSON_TYPES });
      text = await (await handle.getFile()).text();
    } else {
      text = await pickFileFallback();
      if (text == null) return;
    }
    const ws = normalizeWorkspace(JSON.parse(text));
    for (const p of ws.projects) if (state.projects.some((q) => q.id === p.id)) p.id = newProjectId();
    // A blank placeholder project (e.g. after a failed load) is replaced, not kept as an empty tab.
    if (state.projects.length === 1 && !state.tree.nodes.length && !state.tree.log.length) state.projects = [];
    state.projects.push(...ws.projects);
    state.tree = ws.active;
    state.selected = null;
    $('loadError').hidden = true;
    markDirty();
    update();
    toast(ws.projects.length > 1 ? `Imported ${ws.projects.length} projects` : `Imported "${ws.active.title}"`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    alert('Could not import file: ' + err.message);
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

/** Desktop only: ask the app to check GitHub for a newer version now. */
async function checkForUpdates() {
  const btn = $('checkUpdate');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const r = await (await fetch('update/check', { method: 'POST' })).json();
    if (r.status === 'available') toast(`Version ${r.version} found, downloading. You'll be asked to restart.`);
    else if (r.status === 'none') toast(`You're up to date (v${r.version}).`);
    else if (r.status === 'dev') toast('Updates only work in the installed app.');
    else toast(`Couldn't check for updates: ${r.message}`);
  } catch {
    toast("Couldn't check for updates.");
  }
  btn.disabled = false;
  btn.textContent = 'Check for updates';
}

/* ---- What's new (shown once after an update) ---- */

const SEEN_KEY = 'roadmap-tree:lastSeenVersion';

/** Compare 'a.b.c' version strings: negative, 0, or positive. */
function cmpVer(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

async function loadChangelog() {
  try { return await (await fetch('changelog.json', { cache: 'no-store' })).json(); } catch { return []; }
}

const TAG_LABEL = { new: 'New', improved: 'Improved', fixed: 'Fixed' };

/** Fill and open the dialog with these changelog entries (newest first). */
function showWhatsNew(entries, version) {
  $('wnTitle').textContent = version ? `What's new in v${version}` : "What's new";
  $('wnBody').innerHTML = entries.map((e) =>
    `<section><h3>v${esc(e.version)}${e.date ? `<small>${esc(e.date)}</small>` : ''}</h3>`
    + (e.title ? `<p class="wn-sub">${esc(e.title)}</p>` : '')
    + '<ul>' + e.items.map((it) =>
      `<li><span class="chip ${esc(it.tag)}">${esc(TAG_LABEL[it.tag] || it.tag)}</span><span>${esc(it.text)}</span></li>`).join('')
    + '</ul></section>').join('');
  $('whatsNew').hidden = false;
  $('wnClose').focus();
}

/**
 * Desktop startup: if this is a newer version than the one last seen, show
 * what changed since then. A brand-new install gets no popup; an upgrade
 * from a version that predates this feature sees everything since 0.2.1.
 */
async function maybeShowWhatsNew(info) {
  const seen = store.get(SEEN_KEY);
  store.set(SEEN_KEY, info.version);
  if (!seen && info.firstRun) return;
  if (seen && cmpVer(seen, info.version) >= 0) return;
  const from = seen || '0.2.1';
  const entries = (await loadChangelog()).filter((e) => cmpVer(e.version, from) > 0 && cmpVer(e.version, info.version) <= 0);
  if (entries.length) showWhatsNew(entries, info.version);
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Rename the open project in place (its title above the tree); Enter/blur saves, Esc cancels. */
function startTitleEdit() {
  const el = $('title');
  const before = state.tree.title;
  el.contentEditable = 'true';
  el.focus();
  getSelection().selectAllChildren(el);
  const finish = (keep) => {
    el.removeEventListener('blur', onBlur);
    el.removeEventListener('keydown', onKey);
    el.contentEditable = 'false';
    const v = el.textContent.trim();
    if (keep && v && v !== before) commit((t) => { t.title = v; }); else update();
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') finish(false);
  };
  el.addEventListener('blur', onBlur);
  el.addEventListener('keydown', onKey);
}

function bindEvents() {
  const tree = $('tree');
  tree.addEventListener('click', onTreeClick);
  tree.addEventListener('dblclick', onTreeDblClick);
  // Drag a step from anywhere on its row (press and move a few pixels), or from the ≡ handle.
  tree.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.rt-node');
    if (!g || e.button !== 0) return;
    const action = (e.target.closest('[data-action]') || {}).dataset?.action;
    if (action === 'grip') return startDrag(e, g.dataset.id, true);
    if (['timer', 'add', 'delete', 'up', 'down', 'toggle'].includes(action)) return;
    startDrag(e, g.dataset.id, false);
  });

  // Notes pane: Edit/Done toggle, close, and live preview while typing.
  $('noteEdit').onclick = () => {
    state.noteMode = state.noteMode === 'edit' ? 'view' : 'edit';
    update();
    if (state.noteMode === 'edit') $('noteText').focus();
  };
  $('noteClose').onclick = closeNote;
  let previewTimer = null;
  $('noteText').addEventListener('input', () => {
    const hit = findNode(state.tree, state.selected);
    if (!hit) return;
    const v = $('noteText').value;
    if (v.trim()) hit.node.md = v; else delete hit.node.md;
    markDirty();
    updateSaveState();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => drawNotePreview(hit.node), 120);
  });
  $('noteText').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { state.noteMode = 'view'; update(); }
  });

  $('expandAll').onclick = () => { state.collapsed.clear(); saveView(); update(); };
  $('collapseAll').onclick = () => { state.collapsed = new Set(branchIds(state.tree)); saveView(); update(); };
  $('saveBtn').onclick = save;
  $('saveAsBtn').onclick = saveAs;
  $('importBtn').onclick = importFile;
  $('discardBtn').onclick = discard;

  // Project tabs: click to switch, double-click to rename, × to delete, + to add.
  $('projectTabs').addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) { closeProject(close.dataset.close); return; }
    if (e.target.closest('#addProject')) { addProject(); return; }
    const tab = e.target.closest('[data-pid]');
    if (tab) switchProject(tab.dataset.pid);
  });
  $('projectTabs').addEventListener('dblclick', (e) => {
    if (!e.target.closest('[data-close]') && e.target.closest('[data-pid]')) startTitleEdit();
  });

  // Timer hover tip: live time beside the ▶ / ■ button.
  tree.addEventListener('pointerover', (e) => {
    const b = e.target.closest('[data-action="timer"]');
    if (!b) return;
    tipTarget = { id: b.closest('.rt-node').dataset.id };
    fillTip();
  });
  tree.addEventListener('pointerout', (e) => {
    const from = e.target.closest('[data-action="timer"]');
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-action="timer"]') : null;
    if (from && !to) { tipTarget = null; $('tip').hidden = true; }
  });

  // Target date for the open step.
  $('noteDue').addEventListener('change', () => {
    const hit = findNode(state.tree, state.selected);
    if (!hit) return;
    const v = $('noteDue').value;
    commit(() => { if (v) hit.node.due = v; else delete hit.node.due; });
  });

  // Add a top-level (main) step; the per-row "+" only adds children.
  const addRoot = () => {
    const node = { id: newId(state.tree), label: 'New step', status: 'planned' };
    commit((t) => { t.nodes.push(node); });
    startRename(node.id, true);
  };
  $('addRoot').onclick = addRoot;
  $('addRootBottom').onclick = addRoot;

  // Desktop app: show the installed version next to the app name.
  if (IS_DESKTOP) {
    fetch('version.json').then((r) => r.json()).then((v) => {
      $('appVer').textContent = 'v' + v.version;
      appVersion = v.version;
      return maybeShowWhatsNew(v);
    }).catch(() => {});
    $('checkUpdate').hidden = false;
    $('checkUpdate').onclick = checkForUpdates;
  } else {
    $('appVer').textContent = '(web)';
  }

  $('title').addEventListener('dblclick', startTitleEdit);

  // What's new window and the aquarium.
  $('wnClose').onclick = () => { $('whatsNew').hidden = true; };
  $('whatsNew').addEventListener('click', (e) => { if (e.target === $('whatsNew')) $('whatsNew').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('whatsNew').hidden) $('whatsNew').hidden = true; });
  $('whatsNewBtn').onclick = async () => {
    const all = await loadChangelog();
    const shown = appVersion ? all.filter((e) => cmpVer(e.version, appVersion) <= 0) : all;
    showWhatsNew(shown.length ? shown : all, appVersion);
  };
  Aquarium.init({
    toast,
    onChange: (n) => { $('aquariumBtn').textContent = n > 0 ? `Aquarium (${n} ●)` : 'Aquarium'; },
  });
  $('aquariumBtn').onclick = () => Aquarium.toggle();

  // View tabs and calendar navigation.
  document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
  $('calPrev').onclick = () => shiftMonth(-1);
  $('calNext').onclick = () => shiftMonth(1);
  $('calToday').onclick = () => {
    const t = new Date();
    state.cal = { year: t.getFullYear(), month: t.getMonth(), selected: dayKey(t) };
    renderCal();
  };
  $('calGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-action="day"]');
    if (!cell) return;
    state.cal.selected = cell.dataset.day;
    const [y, m] = cell.dataset.day.split('-').map(Number);
    state.cal.year = y;
    state.cal.month = m - 1; // clicking a greyed day from a neighbouring month jumps there
    renderCal();
  });
  $('calDay').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="del-entry"]');
    if (btn) { commit((tree) => { tree.log = tree.log.filter((x) => x.id !== btn.dataset.eid); }); return; }
    const del = e.target.closest('[data-action="del-due"]');
    const hit = del && findNode(state.tree, del.dataset.id);
    if (hit) commit(() => { delete hit.node.due; });
  });
  $('calDay').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.classList.contains('due')) { // set a target date for the chosen step on this day
      const target = findNode(state.tree, f.node.value);
      if (!target) return;
      commit(() => { target.node.due = f.dataset.day; });
      toast(`Target set: "${target.node.label}" by ${fmtDue(f.dataset.day)}`);
      return;
    }
    const minutes = Math.round(Number(f.min.value));
    if (!(minutes > 0)) return;
    const node = findNode(state.tree, f.node.value);
    if (!node) return;
    // Today: the time ends now. Another day: it starts at noon.
    const key = f.dataset.day;
    const len = minutes * MIN;
    const end = key === dayKey(Date.now()) ? Date.now() : dayStart(key) + 12 * 60 * MIN + len;
    commit((tree) => tree.log.push({ id: newLogId(), node: node.node.id, label: node.node.label, start: end - len, end }));
  });
  setInterval(tickTimer, 1000);

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
