/* Aquarium: a small pixel-art fish tank you can drag around the window.
 *
 * Quest loop: finish steps and track time to earn pearls, spend pearls on
 * rarer fish (max 7), feed them now and then and they grow. Fish never die;
 * if they go hungry for a day they just look sleepy.
 *
 * Cheap on purpose: the scene is a 160x100 canvas shown at 2x with pixelated
 * scaling, redrawn ~10 times a second, and the loop stops entirely while the
 * tank is closed, minimized, or the window is hidden.
 *
 * State lives in localStorage (separate from project files), so it survives
 * updates but isn't exported with "Save as...".
 */
(function (root) {
  'use strict';

  const KEY = 'roadmap-tree:aquarium';
  const MAX_FISH = 7;
  const W = 120;           // scene size in pixels (shown at 3x)
  const H = 76;
  const SAND = 10;         // sand height at the bottom
  const FOOD_MAX = 3;      // feed charges you can store
  const FOOD_EVERY = 30 * 60000;   // one charge back every 30 min
  const TIME_PEARL = 30 * 60000;   // tracked time per pearl
  const HUNGRY_AFTER = 24 * 3600000;
  const BABY_UNTIL = 6;    // pellets eaten before a fish is a juvenile
  const JUV_UNTIL = 16;    // ...and before it is an adult

  /* ---- sprites: '.' empty, b body, l belly, f tail/fins, a accent, e eye ---- */
  const SHAPES = {
    slim: {
      adult: ['....aaa......', 'f..bbbbbbb...', 'ffbbbbbbbbbb.', 'fbbbbbbbbbebb', 'ffllllllllll.', 'f..lllllll...', '.....ff......'],
      juv: ['..aa.....', 'f.bbbbb..', 'ffbbbbebb', 'f.llllll.', '...ff....'],
      baby: ['f.bb.', 'fbbeb', 'f.ll.'],
    },
    round: {
      adult: ['....aaaa....', 'f..bbbbbbb..', 'ff.bbbbbbbb.', 'fffbbbbbbbeb', 'fffbbbbbbbbb', 'ff.llllllll.', 'f..lllllll..', '....aaaa....'],
      juv: ['...aaa..', 'f.bbbbb.', 'ffbbbbeb', 'ffbbbbbb', 'f.lllll.', '...aa...'],
      baby: ['f.bb.', 'fbbeb', 'f.ll.'],
    },
  };

  const SPECIES = [
    { id: 'minnow', name: 'Minnow', rarity: 'Common', price: 2, shape: 'slim', pattern: 'none', c: { b: '#9fb4c7', l: '#dbe6ef', f: '#7e93a8', a: '#6c7f93' } },
    { id: 'goldfish', name: 'Goldfish', rarity: 'Common', price: 2, shape: 'round', pattern: 'none', c: { b: '#f08a24', l: '#ffc36b', f: '#ffb04a', a: '#e0701a' } },
    { id: 'neon', name: 'Neon tetra', rarity: 'Uncommon', price: 5, shape: 'slim', pattern: 'stripe', c: { b: '#3b6fd8', l: '#c9d6f2', f: '#7aa2f0', a: '#ff4d6d' } },
    { id: 'angel', name: 'Angelfish', rarity: 'Rare', price: 10, shape: 'round', pattern: 'stripe', c: { b: '#f2e3a0', l: '#fff6d0', f: '#d9c36c', a: '#3a3a3a' } },
    { id: 'betta', name: 'Betta', rarity: 'Rare', price: 12, shape: 'slim', pattern: 'none', c: { b: '#c4264f', l: '#e8638a', f: '#7b2fbf', a: '#a01ec8' } },
    { id: 'puffer', name: 'Pufferfish', rarity: 'Epic', price: 20, shape: 'round', pattern: 'spots', c: { b: '#e8c93a', l: '#fff0a8', f: '#cfa81f', a: '#8a6a10' } },
    { id: 'koi', name: 'Koi', rarity: 'Epic', price: 25, shape: 'slim', pattern: 'patches', c: { b: '#f4f1ea', l: '#ffffff', f: '#e8e3d8', a: '#e8512a' } },
    { id: 'dragon', name: 'Golden dragonfish', rarity: 'Legendary', price: 40, shape: 'slim', pattern: 'glow', c: { b: '#ffd23f', l: '#fff3b0', f: '#22d3ee', a: '#22d3ee' } },
  ];
  const speciesById = (id) => SPECIES.find((s) => s.id === id) || SPECIES[0];

  /* ---- state ---- */

  const fresh = () => ({
    v: 1, fish: [], earned: 0, spent: 0, rewarded: [], timePearls: null,
    food: { n: FOOD_MAX, t: Date.now() }, pos: null, open: false, min: false, starter: false,
  });

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.fish)) return Object.assign(fresh(), s);
    } catch { /* fall through */ }
    return fresh();
  }

  let state = load();
  let hooks = { toast() {}, onChange() {} };
  let totalTracked = 0; // ms, reported by the app; only used for the quest progress line

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } };
  const pearls = () => state.earned - state.spent;
  const stageOf = (f) => (f.eaten < BABY_UNTIL ? 'baby' : f.eaten < JUV_UNTIL ? 'juv' : 'adult');
  const STAGE_NAME = { baby: 'Baby', juv: 'Juvenile', adult: 'Adult' };
  const spriteSize = (f) => { const rows = SHAPES[speciesById(f.sp).shape][stageOf(f)]; return [rows[0].length, rows.length]; };
  const rand = (a, b) => a + Math.random() * (b - a);
  const newId = () => 'f' + Math.random().toString(36).slice(2, 8);

  function changed() { save(); hooks.onChange(pearls()); renderUi(); }

  /** Food charges come back over time; returns the current count. */
  function refreshFood(now = Date.now()) {
    const f = state.food;
    while (f.n < FOOD_MAX && now - f.t >= FOOD_EVERY) { f.n++; f.t += FOOD_EVERY; }
    if (f.n >= FOOD_MAX) f.t = now;
    return f.n;
  }

  /* ---- quests (called by the app) ---- */

  function earn(n, why) {
    state.earned += n;
    hooks.toast(`Quest complete: +${n} pearl${n > 1 ? 's' : ''} (${why})`);
    changed();
  }

  /** A step was marked done. Each step pays once, even if toggled again. */
  function stepDone(key) {
    if (state.rewarded.includes(key)) return;
    state.rewarded.push(key);
    earn(1, 'finished a step');
  }

  /** Total tracked time across all projects (ms). Every 30 min earns a pearl, counted from first use. */
  function trackedTime(totalMs) {
    totalTracked = totalMs;
    const p = Math.floor(totalMs / TIME_PEARL);
    if (state.timePearls == null) { state.timePearls = p; save(); return; }
    if (p > state.timePearls) { const n = p - state.timePearls; state.timePearls = p; earn(n, 'tracked time'); }
  }

  /* ---- actions ---- */

  function buy(id) {
    const sp = SPECIES.find((s) => s.id === id);
    if (!sp || state.fish.length >= MAX_FISH || pearls() < sp.price) return;
    state.spent += sp.price;
    state.fish.push({ id: newId(), sp: sp.id, eaten: 0, fed: Date.now() });
    hooks.toast(`New ${sp.name} joined the tank!`);
    changed();
  }

  function release(id) {
    const f = state.fish.find((x) => x.id === id);
    if (!f || !root.confirm(`Release this ${speciesById(f.sp).name}? Pearls are not refunded.`)) return;
    state.fish = state.fish.filter((x) => x.id !== id);
    sims.delete(id);
    changed();
  }

  /** Drop pellets (uses one food charge). */
  function feed() {
    if (!state.fish.length || refreshFood() < 1) return;
    if (state.food.n >= FOOD_MAX) state.food.t = Date.now();
    state.food.n--;
    const count = Math.min(14, Math.max(4, state.fish.length * 2));
    for (let i = 0; i < count; i++) pellets.push({ x: rand(8, W - 8), y: -rand(0, 14), age: 0 });
    changed();
  }

  /* ---- simulation ---- */

  const sims = new Map();  // fish id -> { x, y, dir, tx, ty, next }
  const pellets = [];
  const bubbles = [];
  let clock = 0;

  function simFor(f) {
    let s = sims.get(f.id);
    if (!s) {
      const [w, h] = spriteSize(f);
      s = { x: rand(4, W - w - 4), y: rand(8, H - SAND - h - 4), dir: Math.random() < 0.5 ? 1 : -1, tx: null, ty: null, next: 0 };
      sims.set(f.id, s);
    }
    return s;
  }

  function step(dt) {
    clock += dt;
    const now = Date.now();
    let dirty = false;

    for (let i = pellets.length - 1; i >= 0; i--) {
      const p = pellets[i];
      p.age += dt;
      if (p.y < H - SAND - 1) p.y += 9 * dt;
      if (p.age > 25) pellets.splice(i, 1);
    }

    state.fish.forEach((f) => {
      const s = simFor(f);
      const [w, h] = spriteSize(f);
      const sleepy = now - f.fed > HUNGRY_AFTER;
      let speed = (stageOf(f) === 'baby' ? 16 : stageOf(f) === 'juv' ? 20 : 24) * (sleepy ? 0.4 : 1);
      const cx = s.x + w / 2;
      const cy = s.y + h / 2;

      // Head for the nearest pellet within range, else wander.
      let target = null;
      let best = 90;
      for (const p of pellets) { const d = Math.hypot(p.x - cx, p.y - cy); if (d < best) { best = d; target = p; } }
      if (target) { s.tx = target.x - w / 2; s.ty = target.y - h / 2; speed *= 1.7; s.next = 0; }
      else if (s.tx == null || clock >= s.next || Math.hypot(s.tx - s.x, s.ty - s.y) < 1.5) {
        s.tx = rand(2, W - w - 2);
        s.ty = rand(6, H - SAND - h - 2);
        s.next = clock + rand(2, 5);
      }

      const dx = s.tx - s.x;
      const dy = s.ty - s.y;
      const dist = Math.hypot(dx, dy);
      const stepLen = speed * dt;
      if (dist > 0.01) {
        const k = Math.min(1, stepLen / dist);
        s.x += dx * k;
        s.y += dy * k;
      }
      if (Math.abs(dx) > 0.8) s.dir = dx > 0 ? 1 : -1;
      s.x = Math.max(1, Math.min(W - w - 1, s.x));
      s.y = Math.max(2, Math.min(H - SAND - h, s.y));

      // Eat a pellet that is close enough.
      for (let i = pellets.length - 1; i >= 0; i--) {
        const p = pellets[i];
        if (Math.abs(p.x - (s.x + w / 2)) <= w / 2 + 1 && Math.abs(p.y - (s.y + h / 2)) <= h / 2 + 1) {
          pellets.splice(i, 1);
          const before = stageOf(f);
          f.eaten++;
          f.fed = now;
          dirty = true;
          if (stageOf(f) !== before) hooks.toast(`Your ${speciesById(f.sp).name} grew up a little!`);
          break;
        }
      }
    });

    if (Math.random() < dt * 0.8 && bubbles.length < 6) bubbles.push({ x: rand(10, W - 10), y: H - SAND - 2, v: rand(8, 16) });
    for (let i = bubbles.length - 1; i >= 0; i--) { bubbles[i].y -= bubbles[i].v * dt; if (bubbles[i].y < 2) bubbles.splice(i, 1); }

    if (dirty) changed();
  }

  /* ---- drawing ---- */

  const spriteCache = new Map();

  /** One species/stage as a tiny offscreen canvas, built once. */
  function sprite(spId, stage) {
    const key = spId + '|' + stage;
    let cv = spriteCache.get(key);
    if (cv) return cv;
    const sp = speciesById(spId);
    const rows = SHAPES[sp.shape][stage];
    const w = rows[0].length;
    const h = rows.length;
    cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    const band = Math.floor(w * 0.45);
    rows.forEach((row, y) => {
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        let col = ch === 'e' ? '#10131a' : sp.c[ch];
        if (ch === 'b' && stage !== 'baby') {
          if (sp.pattern === 'stripe' && (x === band || x === band + 1)) col = sp.c.a;
          else if (sp.pattern === 'spots' && (x * 3 + y * 5) % 7 === 0) col = sp.c.a;
          else if (sp.pattern === 'patches' && ((x >> 1) + (y >> 1)) % 3 === 0) col = sp.c.a;
        }
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    });
    spriteCache.set(key, cv);
    return cv;
  }

  function draw(ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1d4a5e'; ctx.fillRect(0, 0, W, 26);
    ctx.fillStyle = '#194152'; ctx.fillRect(0, 26, W, 26);
    ctx.fillStyle = '#15394a'; ctx.fillRect(0, 52, W, H - 52);

    // Sand with a few darker specks.
    ctx.fillStyle = '#c9b27c'; ctx.fillRect(0, H - SAND, W, SAND);
    ctx.fillStyle = '#dcc790'; ctx.fillRect(0, H - SAND, W, 1);
    ctx.fillStyle = '#a8935f';
    for (let x = 3; x < W; x += 5) ctx.fillRect(x + ((x * 7) % 3), H - SAND + 3 + ((x * 13) % 7), 1, 1);

    // Seaweed, swaying one pixel every half second.
    const sway = Math.floor(clock * 2) % 2;
    ctx.fillStyle = '#2f8f4e';
    [[10, 14], [17, 9], [98, 13], [108, 8]].forEach(([x, hgt]) => {
      for (let i = 0; i < hgt; i++) ctx.fillRect(x + (i > hgt / 2 ? sway : 0), H - SAND - 1 - i, 2, 1);
    });
    ctx.fillStyle = '#7a8088'; ctx.fillRect(54, H - SAND - 3, 8, 4); ctx.fillRect(56, H - SAND - 5, 4, 2); // a rock

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    bubbles.forEach((b) => ctx.fillRect(Math.round(b.x), Math.round(b.y), 1, 1));

    ctx.fillStyle = '#e9a05a';
    pellets.forEach((p) => ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2));

    const now = Date.now();
    state.fish.forEach((f, i) => {
      const s = simFor(f);
      const img = sprite(f.sp, stageOf(f));
      const y = Math.round(s.y + Math.sin(clock * 3 + i) * 0.8);
      ctx.globalAlpha = now - f.fed > HUNGRY_AFTER ? 0.55 : 1;
      if (s.dir < 0) {
        ctx.save();
        ctx.translate(Math.round(s.x) + img.width, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      } else ctx.drawImage(img, Math.round(s.x), y);
      ctx.globalAlpha = 1;
      if (f.sp === 'dragon' && Math.random() < 0.25) { // legendary sparkle
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(s.x + rand(0, img.width)), y + Math.round(rand(-2, img.height + 1)), 1, 1);
      }
    });
  }

  /* ---- UI ---- */

  let el = null; // cached DOM nodes
  let loop = null;
  let last = 0;
  let uiTick = 0;

  const running = () => state.open && !state.min && !document.hidden;

  /** Run the redraw loop only while the tank is actually visible. */
  function syncLoop() {
    if (running()) {
      if (!loop) { last = performance.now(); loop = setInterval(tick, 100); }
    } else if (loop) { clearInterval(loop); loop = null; }
  }

  function tick() {
    const t = performance.now();
    const dt = Math.min(0.25, (t - last) / 1000);
    last = t;
    step(dt);
    draw(el.ctx);
    if (++uiTick % 10 === 0) renderFeed();
  }

  const mmss = (ms) => { const m = Math.ceil(ms / 60000); return m + ' min'; };

  function renderFeed() {
    if (!el) return;
    const n = refreshFood();
    el.feed.textContent = `Feed (${n})`;
    el.feed.disabled = n < 1 || !state.fish.length;
    el.feed.title = n < 1 ? `Next food in ${mmss(FOOD_EVERY - (Date.now() - state.food.t))}` : 'Drop some food';
  }

  function renderUi() {
    if (!el) return;
    el.pearls.textContent = pearls();
    renderFeed();
    if (!el.shop.hidden) renderShop();
  }

  /** Shop panel: quests, fish to buy, and your fish (with Release). */
  function renderShop() {
    const full = state.fish.length >= MAX_FISH;
    const toNext = TIME_PEARL - (totalTracked % TIME_PEARL);
    let html = `<p class="shop-line"><b>${pearls()}</b> pearls · ${state.fish.length}/${MAX_FISH} fish</p>`;
    html += '<p class="shop-quest">Quests: finish a step = 1 pearl. Every 30 min tracked = 1 pearl'
      + ` (next in ${mmss(toNext)}).</p><h4>Buy a fish</h4>`;
    if (full) html += '<p class="shop-note">The tank is full. Release a fish to make room.</p>';
    html += SPECIES.map((sp) => {
      const can = !full && pearls() >= sp.price;
      return `<div class="sp"><canvas class="prev" data-sp="${sp.id}" width="12" height="8"></canvas>`
        + `<span class="sp-name">${sp.name}<small class="r-${sp.rarity.toLowerCase()}">${sp.rarity}</small></span>`
        + `<button type="button" data-buy="${sp.id}"${can ? '' : ' disabled'}>${sp.price} ●</button></div>`;
    }).join('');
    html += '<h4>Your fish</h4>';
    html += state.fish.length ? state.fish.map((f) =>
      `<div class="sp"><canvas class="prev" data-sp="${f.sp}" data-stage="${stageOf(f)}" width="12" height="8"></canvas>`
      + `<span class="sp-name">${speciesById(f.sp).name}<small>${STAGE_NAME[stageOf(f)]} · ${f.eaten} fed</small></span>`
      + `<button type="button" data-release="${f.id}">Release</button></div>`).join('')
      : '<p class="shop-note">No fish yet.</p>';
    el.shop.innerHTML = html;
    el.shop.querySelectorAll('canvas.prev').forEach((cv) => {
      const img = sprite(cv.dataset.sp, cv.dataset.stage || 'adult');
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, Math.floor((cv.height - img.height) / 2));
    });
  }

  function place(x, y) {
    const r = el.tank.getBoundingClientRect();
    el.tank.style.left = Math.max(0, Math.min(root.innerWidth - r.width, x)) + 'px';
    el.tank.style.top = Math.max(0, Math.min(root.innerHeight - r.height, y)) + 'px';
  }

  function show() {
    state.open = true;
    el.tank.hidden = false;
    el.tank.classList.toggle('min', state.min);
    if (!state.starter) { // everyone gets a first fish
      state.starter = true;
      state.fish.push({ id: newId(), sp: 'goldfish', eaten: 0, fed: Date.now() });
      hooks.toast('A little goldfish moved in. Finish steps to earn pearls for more fish.');
    }
    const r = el.tank.getBoundingClientRect();
    const p = state.pos || { x: root.innerWidth - r.width - 20, y: root.innerHeight - r.height - 20 };
    place(p.x, p.y);
    changed();
    syncLoop();
  }

  function hide() {
    state.open = false;
    el.tank.hidden = true;
    save();
    syncLoop();
  }

  function toggle() { if (state.open) hide(); else show(); }

  /** Wire the tank markup (#tank etc. in index.html). hooks = { toast(msg), onChange(pearls) }. */
  function init(h) {
    hooks = Object.assign(hooks, h);
    const $ = (id) => document.getElementById(id);
    el = {
      tank: $('tank'), head: $('tankHead'), canvas: $('tankCanvas'), pearls: $('tankPearls'),
      feed: $('feedBtn'), shopBtn: $('shopBtn'), shop: $('tankShop'), min: $('tankMin'), close: $('tankClose'),
    };
    el.ctx = el.canvas.getContext('2d');

    el.head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.tank.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      el.head.setPointerCapture(e.pointerId);
      const move = (ev) => place(ev.clientX - ox, ev.clientY - oy);
      const up = () => {
        el.head.removeEventListener('pointermove', move);
        el.head.removeEventListener('pointerup', up);
        const b = el.tank.getBoundingClientRect();
        state.pos = { x: b.left, y: b.top };
        save();
      };
      el.head.addEventListener('pointermove', move);
      el.head.addEventListener('pointerup', up);
    });

    el.feed.onclick = feed;
    el.shopBtn.onclick = () => { el.shop.hidden = !el.shop.hidden; if (!el.shop.hidden) renderShop(); };
    el.close.onclick = hide;
    el.min.onclick = () => {
      state.min = !state.min;
      el.tank.classList.toggle('min', state.min);
      save();
      syncLoop();
    };
    el.shop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-buy]');
      if (b) { buy(b.dataset.buy); return; }
      const r = e.target.closest('[data-release]');
      if (r) release(r.dataset.release);
    });

    document.addEventListener('visibilitychange', syncLoop);
    root.addEventListener('resize', () => { if (state.open) { const b = el.tank.getBoundingClientRect(); place(b.left, b.top); } });

    hooks.onChange(pearls());
    if (state.open) show();
  }

  root.Aquarium = { init, toggle, stepDone, trackedTime, pearls, SPECIES, MAX_FISH };
})(window);
