/* Graph tab: the open project as a web of dots, like Obsidian's graph view.
 *
 * Every step is a dot joined to its parent (the project itself is the centre
 * dot). A step whose notes mention another step as [[its name]] gets a dashed
 * line to it. Drag a dot and the rest of the web follows; scroll to zoom, drag
 * the background to pan, click a dot to jump to that step.
 *
 * Colour: green = done / in progress (pulsing), hollow = planned; a red or
 * orange ring means overdue or due soon. The physics stops once the web
 * settles, and nothing runs while the tab is hidden.
 *
 * Relies on app.js globals (loaded after this file, used only when called):
 * state, $, statusOf, urgency, dayKey, walk, goToStep, selectNode.
 */
const Graph = (() => {
  let canvas = null;
  let ctx = null;
  let nodes = [];
  let edges = [];
  let byId = new Map();
  const view = { x: 0, y: 0, k: 1 }; // world point at the canvas centre, and zoom
  let W = 0;
  let H = 0;
  let dpr = 1;
  let visible = false;
  let raf = null;
  let idle = null;
  let hover = null;
  let drag = null;       // { node, moved } while a dot is held
  let pan = null;        // { x, y, vx, vy } while the background is held
  let colors = null;
  let lastProject = null;
  let frame = 0;
  let needFit = true; // zoom to fit once the first layout has settled (until the user zooms or pans)

  /** Read the theme colours once in a while (not every frame). */
  function readColors() {
    const s = getComputedStyle(document.documentElement);
    const c = (n) => s.getPropertyValue(n).trim();
    colors = { bg: c('--bg'), fg: c('--fg'), muted: c('--muted'), line: c('--line'), green: c('--green'), planned: c('--planned'), danger: c('--danger'), orange: c('--orange') };
  }

  /** Rebuild dots and lines from the open project, keeping positions of dots that already exist. */
  function build() {
    const tree = state.tree;
    const today = dayKey(Date.now());
    const prev = new Map(nodes.map((n) => [n.id, n]));
    const fresh = lastProject !== tree.id;
    lastProject = tree.id;
    if (fresh) { needFit = true; view.x = 0; view.y = 0; view.k = 1; }
    nodes = [];
    edges = [];
    byId = new Map();

    const add = (n, parent) => {
      const old = !fresh && prev.get(n.id);
      const p = parent && byId.get(parent);
      n.x = old ? old.x : p ? p.x + (Math.random() - 0.5) * 50 : (Math.random() - 0.5) * 40;
      n.y = old ? old.y : p ? p.y + (Math.random() - 0.5) * 50 : (Math.random() - 0.5) * 40;
      n.vx = old ? old.vx : 0;
      n.vy = old ? old.vy : 0;
      byId.set(n.id, n);
      nodes.push(n);
      if (parent) edges.push({ a: parent, b: n.id, kind: 'tree' });
    };

    add({ id: '__root', label: tree.title, kind: 'root', status: 'root', kids: tree.nodes.length, level: null, depth: 0 }, null);
    const labels = new Map();
    const visit = (list, parent, depth) => {
      for (const s of list) {
        const u = urgency(s, today);
        add({ id: s.id, label: s.label || '(untitled)', kind: 'step', status: statusOf(s), kids: s.children ? s.children.length : 0, level: u && u.level !== 'done' ? u.level : null, depth, md: s.md || '' }, parent);
        labels.set((s.label || '').trim().toLowerCase(), s.id);
        if (s.children) visit(s.children, s.id, depth + 1);
      }
    };
    visit(tree.nodes, '__root', 1);

    // [[step name]] mentions in notes become dashed lines.
    for (const n of nodes) {
      if (!n.md) continue;
      for (const m of n.md.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const target = labels.get(m[1].trim().toLowerCase());
        if (target && target !== n.id && !edges.some((e) => (e.a === n.id && e.b === target) || (e.a === target && e.b === n.id))) {
          edges.push({ a: n.id, b: target, kind: 'ref' });
        }
      }
    }

    // Opening a project for the first time: let the web settle off-screen so it appears already arranged.
    if (fresh) {
      for (let i = 0; i < 300; i++) physics();
      for (const n of nodes) { n.vx = 0; n.vy = 0; }
      fit();
    }
  }

  const radius = (n) => (n.kind === 'root' ? 9 : 4 + Math.min(6, n.kids * 0.9));

  /** One physics step: nodes repel, lines are springs, a faint pull keeps everything near the centre. */
  function physics() {
    const len = nodes.length;
    for (let i = 0; i < len; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < len; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.3; }
        if (d2 > 90000) continue; // too far to matter
        const f = Math.min(40, 3600 / d2);
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    for (const e of edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = e.kind === 'ref' ? 110 : 52 + Math.min(30, b.kids * 4);
      const f = (d - rest) * (e.kind === 'ref' ? 0.006 : 0.03);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    let energy = 0;
    for (const n of nodes) {
      n.vx -= n.x * 0.004;
      n.vy -= n.y * 0.004;
      n.vx *= 0.82;
      n.vy *= 0.82;
      if (drag && drag.node === n) { n.vx = 0; n.vy = 0; continue; }
      n.x += n.vx;
      n.y += n.vy;
      energy += n.vx * n.vx + n.vy * n.vy;
    }
    return energy;
  }

  const toScreen = (n) => ({ x: (n.x - view.x) * view.k + W / 2, y: (n.y - view.y) * view.k + H / 2 });
  const toWorld = (sx, sy) => ({ x: (sx - W / 2) / view.k + view.x, y: (sy - H / 2) / view.k + view.y });

  function neighbours(id) {
    const s = new Set([id]);
    for (const e of edges) { if (e.a === id) s.add(e.b); else if (e.b === id) s.add(e.a); }
    return s;
  }

  function draw(t) {
    if (!colors || frame++ % 60 === 0) readColors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const focus = hover ? neighbours(hover.id) : null;
    const dim = (id) => (focus && !focus.has(id) ? 0.18 : 1);

    ctx.lineWidth = 1;
    for (const e of edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (!a || !b) continue;
      const p = toScreen(a);
      const q = toScreen(b);
      ctx.globalAlpha = Math.min(dim(e.a), dim(e.b)) * (e.kind === 'ref' ? 0.9 : 0.8);
      ctx.strokeStyle = e.kind === 'ref' ? colors.muted : colors.line;
      ctx.setLineDash(e.kind === 'ref' ? [4, 4] : []);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const n of nodes) {
      const p = toScreen(n);
      const r = radius(n) * Math.max(0.7, Math.min(1.6, view.k));
      ctx.globalAlpha = dim(n.id);
      if (n.status === 'active') { // soft pulsing ring
        const pulse = (Math.sin(t / 450) + 1) / 2;
        ctx.fillStyle = colors.green;
        ctx.globalAlpha = dim(n.id) * (0.28 - 0.2 * pulse);
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 3 + pulse * 5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = dim(n.id);
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (n.kind === 'root') { ctx.fillStyle = colors.fg; ctx.fill(); }
      else if (n.status === 'done' || n.status === 'active') { ctx.fillStyle = colors.green; ctx.fill(); }
      else { ctx.fillStyle = colors.bg; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = colors.planned; ctx.stroke(); }
      if (n.level === 'overdue' || n.level === 'soon') { // deadline ring
        ctx.lineWidth = 2;
        ctx.strokeStyle = n.level === 'overdue' ? colors.danger : colors.orange;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Labels: for the centre, branches, the hovered dot and its neighbours, or everything when zoomed in / small.
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (const n of nodes) {
      const show = n.kind === 'root' || n.kids > 0 || nodes.length < 40 || view.k > 1.3 || (focus && focus.has(n.id));
      if (!show) continue;
      const p = toScreen(n);
      const r = radius(n) * Math.max(0.7, Math.min(1.6, view.k));
      ctx.globalAlpha = dim(n.id);
      ctx.fillStyle = colors.fg;
      const text = n.label.length > 28 && !(hover && hover.id === n.id) ? n.label.slice(0, 27) + '…' : n.label;
      ctx.fillText(text, p.x + r + 6, p.y);
    }
    ctx.globalAlpha = 1;
  }

  /** Animation loop: run physics until the web settles, then redraw slowly only if something pulses. */
  function tick(t) {
    raf = null;
    if (!visible || document.hidden) return;
    let energy = 0;
    for (let i = 0; i < 2; i++) energy = physics();
    if (needFit && energy < 0.4 && !drag && !pan) fit();
    draw(t);
    if (energy > 0.05 || drag || pan) { raf = requestAnimationFrame(tick); return; }
    if (nodes.some((n) => n.status === 'active')) idle = setTimeout(() => { idle = null; draw(performance.now()); if (visible) wakeSlow(); }, 100);
  }

  /** Centre the web and zoom so it fills most of the window. */
  function fit() {
    needFit = false;
    if (!nodes.length || !W || !H) return;
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    const bw = Math.max(80, x1 - x0) + 220; // room for the labels
    const bh = Math.max(80, y1 - y0) + 100;
    view.k = Math.max(0.5, Math.min(1.8, Math.min(W / bw, H / bh)));
    view.x = (x0 + x1) / 2;
    view.y = (y0 + y1) / 2;
  }

  /** Keep the active-dot pulse alive at ~10 frames a second once the physics has stopped. */
  function wakeSlow() {
    if (idle || raf || !visible || document.hidden) return;
    if (nodes.some((n) => n.status === 'active')) idle = setTimeout(() => { idle = null; if (visible && !document.hidden && !raf) { draw(performance.now()); wakeSlow(); } }, 100);
  }

  function wake() {
    if (idle) { clearTimeout(idle); idle = null; }
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick);
  }

  function resize() {
    const wrap = $('graphWrap');
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = window.devicePixelRatio || 1;
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }

  const hit = (sx, sy) => {
    let best = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const p = toScreen(n);
      const d = Math.hypot(p.x - sx, p.y - sy);
      const r = radius(n) * Math.max(0.7, Math.min(1.6, view.k)) + 5;
      if (d <= r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };

  function show() {
    visible = true;
    resize();
    build();
    wake();
  }

  function hide() {
    visible = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (idle) { clearTimeout(idle); idle = null; }
    drag = null;
    pan = null;
  }

  function releaseGestures() { drag = null; pan = null; }

  function init() {
    canvas = $('graphCanvas');
    ctx = canvas.getContext('2d');
    $('graphHud').innerHTML = '<span><i class="gd planned"></i>planned</span><span><i class="gd done"></i>done / active</span>'
      + '<span><i class="gd ring-soon"></i>due soon</span><span><i class="gd ring-over"></i>overdue</span>'
      + '<span class="gh-tip">Drag dots · scroll to zoom · drag background to pan · click a dot to open it</span>'
      + '<button type="button" id="graphReset">Re-layout</button>';
    $('graphReset').onclick = () => {
      for (const n of nodes) { n.x = (Math.random() - 0.5) * 200; n.y = (Math.random() - 0.5) * 200; n.vx = n.vy = 0; }
      view.x = 0; view.y = 0; view.k = 1;
      needFit = true;
      wake();
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const n = hit(sx, sy);
      canvas.setPointerCapture(e.pointerId);
      needFit = false; // the user is steering now
      if (n) drag = { node: n, moved: false, sx, sy };
      else pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      wake();
    });

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (drag) {
        if (Math.hypot(sx - drag.sx, sy - drag.sy) > 4) drag.moved = true;
        const w = toWorld(sx, sy);
        drag.node.x = w.x;
        drag.node.y = w.y;
        wake();
      } else if (pan) {
        view.x = pan.vx - (e.clientX - pan.x) / view.k;
        view.y = pan.vy - (e.clientY - pan.y) / view.k;
        wake();
      } else {
        const h = hit(sx, sy);
        if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : 'grab'; wake(); }
      }
    });

    const up = (e) => {
      const d = drag;
      releaseGestures();
      if (e.type === 'pointerup' && d && !d.moved && d.node.kind === 'step') { // a click, not a drag
        goToStep(state.tree.id, d.node.id);
        if (d.node.md) selectNode(d.node.id);
      }
      wake();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', () => { releaseGestures(); wake(); });
    canvas.addEventListener('pointerleave', () => { if (hover && !drag && !pan) { hover = null; wake(); } });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      needFit = false;
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const before = toWorld(sx, sy);
      view.k = Math.max(0.3, Math.min(3, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const after = toWorld(sx, sy);
      view.x += before.x - after.x; // keep the point under the cursor fixed
      view.y += before.y - after.y;
      wake();
    }, { passive: false });

    window.addEventListener('blur', releaseGestures);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    if (window.ResizeObserver) new ResizeObserver(() => { if (visible) { resize(); wake(); } }).observe($('graphWrap'));
    canvas.style.cursor = 'grab';
  }

  return {
    init, show, hide,
    refresh() { if (visible) { build(); wake(); } },
    /** Page position of a dot (CSS pixels), for checking the layout from the console. */
    screenPos(id) {
      const n = byId.get(id);
      if (!n || !canvas) return null;
      const r = canvas.getBoundingClientRect();
      const p = toScreen(n);
      return { x: r.left + p.x, y: r.top + p.y };
    },
    /** Read-only snapshot, for checking the layout from the console. */
    stats() {
      const xs = nodes.map((n) => n.x);
      const ys = nodes.map((n) => n.y);
      return { n: nodes.length, k: view.k, vx: view.x, vy: view.y, W, H, running: !!raf, idle: !!idle, needFit,
        bbox: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(Math.round) };
    },
  };
})();
