/* Companion box: a small pixel-art habitat you can drag around the window.
 * Pick ONE in Settings: an aquarium (fish) or a jungle (animals), or turn it off.
 *
 * Quest loop (shared by both): finish steps and track time to earn pearls,
 * spend pearls on rarer pets (max 7 per habitat) and, in the aquarium, on
 * decorations. Feed them now and then and they grow. Pets never die; after a
 * day without food they just look sleepy. Each habitat keeps its own pets and
 * food, but the pearls are one shared pool, so switching never loses anything.
 *
 * Cheap on purpose: the scene is a small canvas (about 120x76 px) shown at 3x
 * with pixelated scaling, redrawn ~10 times a second, and the loop stops
 * entirely while the box is closed, minimized, or the window is hidden.
 *
 * State lives in localStorage (separate from project files), so it survives
 * updates but isn't exported with "Save as...".
 */
(function (root) {
  'use strict';

  const KEY = 'roadmap-tree:aquarium';
  const MAX_PETS = 7;
  const SCALE = 3;                 // canvas pixels -> screen pixels
  const FOOD_MAX = 3;              // feed charges you can store
  const FOOD_EVERY = 30 * 60000;   // one charge back every 30 min
  const TIME_PEARL = 30 * 60000;   // tracked time per pearl
  const HUNGRY_AFTER = 24 * 3600000;
  const BABY_UNTIL = 6;            // pellets eaten before a pet is a juvenile
  const JUV_UNTIL = 16;            // ...and before it is an adult
  const EYE = '#10131a';

  /* ---- sprites: '.' empty, b body, l belly, f fins/limbs/wing, a accent, t tail, e eye ---- */
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
    quad: {
      adult: ['..........bb..', 't.bbbbbbbbbbbb', 'ttbbbbbbbbbebb', 'tbbbbbbbbbbbba', '.bbbbbbbbbbbb.', '.llllllllllll.', '..ff....ff....', '..ff....ff....', '.fff...fff....'],
      juv: ['......bb..', 't.bbbbbbbb', 'tbbbbbbebb', 'tbbbbbbbba', '.llllllll.', '.ff...ff..', '.ff...ff..'],
      baby: ['....b.', 't.bbbb', 'tbbebb', '.llll.', '.f..f.'],
    },
    bird: {
      adult: ['.....bbbb...', '...bbbbbbb..', 'f..bbbbbbeba', 'ff.bfffbbbaa', 'fffbfffbbbb.', 'fff.lllllll.', '....lllll...', '....f..f....', '...ff..ff...'],
      juv: ['....bbb..', '..bbbbbb.', 'f.bbbbeba', 'ffbfbbbaa', 'ff.lllll.', '...f..f..', '..ff.ff..'],
      baby: ['..bb..', '.bbbb.', 'fbbeba', '.llll.', '.f..f.'],
    },
    frog: {
      adult: ['.......ee..', '..bbbbbbbbb', '.bbbbbbbbba', 'bbbbbbbbbbb', 'lllllllllll', 'fff.....fff', 'ffff...ffff'],
      juv: ['.....ee.', '.bbbbbbb', 'bbbbbbba', 'llllllll', 'fff..fff'],
      baby: ['...e.', 'bbbba', 'bllll', 'f...f'],
    },
  };

  /* ---- species ---- */
  const FISH = [
    { id: 'minnow', name: 'Minnow', rarity: 'Common', price: 2, shape: 'slim', pattern: 'none', mode: 'swim', c: { b: '#9fb4c7', l: '#dbe6ef', f: '#7e93a8', a: '#6c7f93' } },
    { id: 'goldfish', name: 'Goldfish', rarity: 'Common', price: 2, shape: 'round', pattern: 'none', mode: 'swim', c: { b: '#f08a24', l: '#ffc36b', f: '#ffb04a', a: '#e0701a' } },
    { id: 'neon', name: 'Neon tetra', rarity: 'Uncommon', price: 5, shape: 'slim', pattern: 'stripe', mode: 'swim', c: { b: '#3b6fd8', l: '#c9d6f2', f: '#7aa2f0', a: '#ff4d6d' } },
    { id: 'angel', name: 'Angelfish', rarity: 'Rare', price: 10, shape: 'round', pattern: 'stripe', mode: 'swim', c: { b: '#f2e3a0', l: '#fff6d0', f: '#d9c36c', a: '#3a3a3a' } },
    { id: 'betta', name: 'Betta', rarity: 'Rare', price: 12, shape: 'slim', pattern: 'none', mode: 'swim', c: { b: '#c4264f', l: '#e8638a', f: '#7b2fbf', a: '#a01ec8' } },
    { id: 'puffer', name: 'Pufferfish', rarity: 'Epic', price: 20, shape: 'round', pattern: 'spots', mode: 'swim', c: { b: '#e8c93a', l: '#fff0a8', f: '#cfa81f', a: '#8a6a10' } },
    { id: 'koi', name: 'Koi', rarity: 'Epic', price: 25, shape: 'slim', pattern: 'patches', mode: 'swim', c: { b: '#f4f1ea', l: '#ffffff', f: '#e8e3d8', a: '#e8512a' } },
    { id: 'dragon', name: 'Golden dragonfish', rarity: 'Legendary', price: 40, shape: 'slim', pattern: 'glow', mode: 'swim', c: { b: '#ffd23f', l: '#fff3b0', f: '#22d3ee', a: '#22d3ee' } },
  ];

  const ANIMALS = [
    { id: 'frog', name: 'Tree frog', rarity: 'Common', price: 2, shape: 'frog', pattern: 'spots', mode: 'hop', speed: 1, c: { b: '#4caf50', l: '#c5e8a0', f: '#2e7d32', a: '#1f5a24' } },
    { id: 'parrot', name: 'Parrot', rarity: 'Uncommon', price: 5, shape: 'bird', pattern: 'none', mode: 'fly', speed: 1.2, c: { b: '#e53935', l: '#ff8a80', f: '#1e88e5', a: '#ffd54f' } },
    { id: 'monkey', name: 'Monkey', rarity: 'Rare', price: 10, shape: 'quad', pattern: 'none', mode: 'walk', speed: 0.9, c: { b: '#8d5a2b', l: '#e0b98a', f: '#5e3a1a', a: '#e0b98a', t: '#5e3a1a' } },
    { id: 'toucan', name: 'Toucan', rarity: 'Rare', price: 12, shape: 'bird', pattern: 'none', mode: 'fly', speed: 1.1, c: { b: '#212121', l: '#f5f5f5', f: '#37474f', a: '#ff9800' } },
    { id: 'sloth', name: 'Sloth', rarity: 'Epic', price: 20, shape: 'quad', pattern: 'none', mode: 'walk', speed: 0.3, c: { b: '#a1887f', l: '#d7ccc8', f: '#6d4c41', a: '#4e342e', t: '#a1887f' } },
    { id: 'jaguar', name: 'Jaguar', rarity: 'Legendary', price: 40, shape: 'quad', pattern: 'spots', mode: 'walk', speed: 1.1, c: { b: '#f2b138', l: '#ffe0a3', f: '#c98a1a', a: '#3b2a14', t: '#c98a1a' } },
  ];

  /* ---- aquarium decorations (bought with pearls) ---- */
  const DECOS = [
    { id: 'plant', name: 'Tall plant', desc: 'Sways gently', price: 3, sway: true, c: { g: '#2f9a55', d: '#1e6b3a' },
      rows: ['..g...', '..gg.g', '.ggg.g', '.gg.gg', '.gg.g.', 'ggg.g.', '.gg.g.', '.ggg..', '..gg..', '..gg..', '..gg..', '..dd..'] },
    { id: 'coral', name: 'Coral', desc: 'A pink reef branch', price: 4, c: { o: '#e8707f', h: '#ffb3bd' },
      rows: ['..o..o...', '.hh..oo.o', '.oo.oo.oo', '..ooooo..', '..ooooo..', '...ooo...', '...ooo...', '..ooooo..'] },
    { id: 'airstone', name: 'Air stone', desc: 'A steady stream of bubbles', price: 4, c: { s: '#8a8f98', h: '#b4bac2' }, rows: ['.hhhh.', 'ssssss'] },
    { id: 'wood', name: 'Driftwood', desc: 'Weathered branch', price: 5, c: { b: '#8a5a2b', d: '#5e3d1c' },
      rows: ['..........bb..', '.bb.....bbbbb.', 'bbbbbbbbbbbbbb', 'dbbbbbbbbbbbbb', '.ddbbbbbbbbdd.', '...dddddddd...'] },
    { id: 'castle', name: 'Castle', desc: 'A little stone fortress', price: 8, c: { g: '#9aa0a6', w: '#3a3f45', d: '#5b3a1e' },
      rows: ['g.g.g....g.g.g', 'ggggg....ggggg', 'gwwwg....gwwwg', 'ggggg....ggggg', 'gggggggggggggg', 'gggggggggggggg', 'ggwwggggggwwgg',
        'gggggddddggggg', 'gggggddddggggg', 'gggggddddggggg', 'gggggddddggggg', 'gggggddddggggg'] },
    { id: 'chest', name: 'Treasure chest', desc: 'Puffs out bubbles now and then', price: 10, burst: true, c: { b: '#8a5a2b', d: '#5e3d1c', y: '#f2c94c' },
      rows: ['.bbbbbbbb.', 'bbbbbbbbbb', 'yyyyyyyyyy', 'bbbbyybbbb', 'bbbbbbbbbb', 'dddddddddd'] },
    { id: 'diver', name: 'Diver statue', desc: 'An old brass diver', price: 15, c: { h: '#c9a227', w: '#7fd0ff', c: '#3a4a8a', f: '#e8a23a' },
      rows: ['..hhhh..', '.hwwwwh.', '.hwwwwh.', '..hhhh..', '.cccccc.', 'cccccccc', 'cccccccc', '.cccccc.', '.cc..cc.', '.cc..cc.', 'fff..fff'] },
  ];
  const decoById = (id) => DECOS.find((d) => d.id === id);

  const ENCLOSURES = [
    { id: 'classic', name: 'Classic', desc: 'An open scene with sand and plants.' },
    { id: 'cube', name: 'Glass cube', desc: 'A realistic square tank with an air pump.' },
  ];

  /* ---- scenes: w/h in canvas pixels, floor = where the ground starts ---- */
  const SCENES = {
    classic: { w: 120, h: 76, floor: 66, xMin: 1, xMax: 119, yMin: 4 },
    cube: { w: 100, h: 100, floor: 87, xMin: 5, xMax: 89, yMin: 9 },
    jungle: { w: 120, h: 76, floor: 64, xMin: 1, xMax: 119, yMin: 4 },
  };

  const HABITATS = {
    aquarium: { id: 'aquarium', title: 'Aquarium', species: FISH, plural: 'fish', one: 'a fish', starter: 'goldfish', starterMsg: 'A little goldfish moved in. Finish steps to earn pearls for more fish.', foodWord: 'food' },
    jungle: { id: 'jungle', title: 'Jungle', species: ANIMALS, plural: 'animals', one: 'an animal', starter: 'frog', starterMsg: 'A little tree frog hopped in. Finish steps to earn pearls for more animals.', foodWord: 'fruit' },
  };

  /* ---- state ---- */

  const fresh = () => ({
    v: 2, earned: 0, spent: 0, rewarded: [], timePearls: null,   // shared by both habitats
    pos: null, open: false, min: false,
    habitat: 'aquarium', enclosure: 'classic', decos: [],
    fish: [], food: { n: FOOD_MAX, t: Date.now() }, starter: false, // the aquarium
    jungle: { animals: [], food: { n: FOOD_MAX, t: Date.now() }, starter: false },
  });

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.fish)) {
        const st = Object.assign(fresh(), s);
        st.jungle = Object.assign({ animals: [], food: { n: FOOD_MAX, t: Date.now() }, starter: false }, s.jungle);
        if (!HABITATS[st.habitat]) st.habitat = 'aquarium';
        if (!ENCLOSURES.some((e) => e.id === st.enclosure)) st.enclosure = 'classic';
        if (!Array.isArray(st.decos)) st.decos = [];
        return st;
      }
    } catch { /* fall through */ }
    return fresh();
  }

  let state = load();
  let hooks = { toast() {}, onChange() {} };
  let totalTracked = 0; // ms, reported by the app; only used for the quest progress line
  let enabled = true;   // false when the companion is switched off in Settings

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } };
  const pearls = () => state.earned - state.spent;
  const hab = () => HABITATS[state.habitat];
  const pets = () => (state.habitat === 'jungle' ? state.jungle.animals : state.fish);
  const setPets = (a) => { if (state.habitat === 'jungle') state.jungle.animals = a; else state.fish = a; };
  const foodOf = () => (state.habitat === 'jungle' ? state.jungle.food : state.food);
  const sceneNow = () => (state.habitat === 'jungle' ? SCENES.jungle : SCENES[state.enclosure] || SCENES.classic);
  const speciesOf = (id) => hab().species.find((s) => s.id === id) || hab().species[0];
  const stageOf = (f) => (f.eaten < BABY_UNTIL ? 'baby' : f.eaten < JUV_UNTIL ? 'juv' : 'adult');
  const STAGE_NAME = { baby: 'Baby', juv: 'Juvenile', adult: 'Adult' };
  const spriteSize = (f) => { const rows = SHAPES[speciesOf(f.sp).shape][stageOf(f)]; return [rows[0].length, rows.length]; };
  const rand = (a, b) => a + Math.random() * (b - a);
  const newId = () => 'f' + Math.random().toString(36).slice(2, 8);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function changed() { save(); hooks.onChange(pearls(), hab().title); renderUi(); }

  /** Food charges come back over time; returns the current count. */
  function refreshFood(now = Date.now()) {
    const f = foodOf();
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

  /** What to call a pet: the name you gave it, else its species. */
  const petName = (f) => f.name || speciesOf(f.sp).name;
  const MAX_NAME = 24;
  let renamingId = null; // pet whose name box is open in the shop

  /** Save a pet's name (empty text clears it back to the species name). */
  function setPetName(id, text) {
    const f = pets().find((x) => x.id === id);
    if (!f) return;
    const name = String(text || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (name) f.name = name; else delete f.name;
  }

  function buy(id) {
    const sp = hab().species.find((s) => s.id === id);
    if (!sp || pets().length >= MAX_PETS || pearls() < sp.price) return;
    state.spent += sp.price;
    const pet = { id: newId(), sp: sp.id, eaten: 0, fed: Date.now() };
    pets().push(pet);
    renamingId = pet.id; // offer a name straight away (it can be skipped)
    hooks.toast(`New ${sp.name} joined! Give it a name below, or skip.`);
    changed();
    if (el) { const box = el.shop.querySelector('.pname-in'); if (box) { box.scrollIntoView({ block: 'nearest' }); box.focus(); } }
  }

  function release(id) {
    const f = pets().find((x) => x.id === id);
    if (!f || !root.confirm(`Release ${f.name ? f.name + ' the ' + speciesOf(f.sp).name : 'this ' + speciesOf(f.sp).name}? Pearls are not refunded.`)) return;
    setPets(pets().filter((x) => x.id !== id));
    sims.delete(id);
    changed();
  }

  function buyDeco(id) {
    const d = decoById(id);
    if (!d || state.decos.some((x) => x.id === id) || pearls() < d.price) return;
    state.spent += d.price;
    state.decos.push({ id, hide: false });
    hooks.toast(`${d.name} added to the tank.`);
    changed();
  }

  function toggleDeco(id) {
    const d = state.decos.find((x) => x.id === id);
    if (d) { d.hide = !d.hide; changed(); }
  }

  function setEnclosure(id) {
    if (!ENCLOSURES.some((e) => e.id === id) || state.enclosure === id) return;
    state.enclosure = id;
    resetScene();
    changed();
  }

  /**
   * Drop food where you clicked (scene pixels). Uses one charge from the food
   * meter and scatters a few pellets or fruit around that spot; they sink, and
   * the pets that were following your cursor swim over to eat them.
   */
  function feedAt(x, y) {
    if (!pets().length) return;
    if (refreshFood() < 1) {
      hooks.toast(`No ${hab().foodWord} right now. Next in ${mmss(FOOD_EVERY - (Date.now() - foodOf().t))}.`);
      return;
    }
    const sc = sceneNow();
    const f = foodOf();
    if (f.n >= FOOD_MAX) f.t = Date.now();
    f.n--;
    const count = Math.min(14, Math.max(4, pets().length * 2));
    for (let i = 0; i < count; i++) {
      pellets.push({
        x: Math.max(sc.xMin + 2, Math.min(sc.xMax - 4, x + rand(-7, 7))),
        y: Math.max(sc.yMin, Math.min(sc.floor - 4, y)) - rand(0, 6),
        age: 0,
      });
    }
    changed();
  }

  /** The mouse over the scene, in scene pixels; pets come toward it as if expecting food. */
  let hoverAt = null;

  /* ---- simulation ---- */

  const sims = new Map();  // pet id -> { x, y, dir, tx, ty, next, phase }
  let pellets = [];
  let bubbles = [];
  let clock = 0;
  let chestNext = 3;

  /** Forget positions and food after the scene changes (habitat or enclosure). */
  function resetScene() { sims.clear(); pellets = []; bubbles = []; hoverAt = null; }

  function simFor(f) {
    let s = sims.get(f.id);
    if (!s) {
      const sc = sceneNow();
      const [w, h] = spriteSize(f);
      const ground = speciesOf(f.sp).mode === 'walk' || speciesOf(f.sp).mode === 'hop';
      s = {
        x: rand(sc.xMin + 3, sc.xMax - w - 3),
        y: ground ? sc.floor - h : rand(sc.yMin + 4, sc.floor - h - 4),
        dir: Math.random() < 0.5 ? 1 : -1, tx: null, ty: null, next: 0, phase: 0,
        fx: rand(-11, 11), fy: rand(-6, 6), // where this pet likes to wait near the cursor, so they don't all stack up
      };
      sims.set(f.id, s);
    }
    return s;
  }

  /** Where the aquarium's decorations sit, left to right in the order they were bought. */
  function placedDecos(sc) {
    const out = [];
    let x = sc.xMin + 3;
    const limit = sc.xMax - 3;
    for (const o of state.decos) {
      const d = decoById(o.id);
      if (!d || o.hide) continue;
      const w = d.rows[0].length;
      if (x + w > limit) continue; // no room left, stays in the shop inventory
      out.push({ d, x, y: sc.floor - d.rows.length + 2 });
      x += w + 3;
    }
    return out;
  }

  function step(dt) {
    clock += dt;
    const now = Date.now();
    const sc = sceneNow();
    let dirty = false;

    for (let i = pellets.length - 1; i >= 0; i--) {
      const p = pellets[i];
      p.age += dt;
      if (p.y < sc.floor - 1) p.y += 9 * dt;
      if (p.age > 25) pellets.splice(i, 1);
    }

    pets().forEach((f) => {
      const s = simFor(f);
      const sp = speciesOf(f.sp);
      const [w, h] = spriteSize(f);
      const mode = sp.mode;
      const ground = mode === 'walk' || mode === 'hop';
      const sleepy = now - f.fed > HUNGRY_AFTER;
      const baseSpeed = stageOf(f) === 'baby' ? 16 : stageOf(f) === 'juv' ? 20 : 24;
      let speed = baseSpeed * (sp.speed || 1) * (sleepy ? 0.4 : 1);
      const yMin = ground ? sc.floor - h : mode === 'fly' ? sc.yMin : sc.yMin + 2;
      const yMax = ground ? sc.floor - h : mode === 'fly' ? sc.floor - h - 14 : sc.floor - h - 2;
      const cx = s.x + w / 2;
      const cy = s.y + h / 2;

      // Head for the nearest pellet within range (ground animals and birds only care about the ones that landed), else wander.
      let target = null;
      let best = 90;
      for (const p of pellets) {
        if ((ground || mode === 'fly') && p.y < sc.floor - 16) continue; // birds fly down for fruit that has landed
        const d = ground ? Math.abs(p.x - cx) : Math.hypot(p.x - cx, p.y - cy);
        if (d < best) { best = d; target = p; }
      }
      if (target) { s.tx = target.x - w / 2; s.ty = ground ? yMax : target.y - h / 2; speed *= 1.7; s.next = 0; }
      else if (hoverAt) { // the mouse is over the scene: come and see, as if you're about to feed them
        s.tx = Math.max(sc.xMin, Math.min(sc.xMax - w, hoverAt.x + s.fx - w / 2));
        s.ty = ground ? yMax : Math.max(yMin, Math.min(yMax, hoverAt.y + s.fy - h / 2));
        speed *= 1.4;
        s.next = 0;
      }
      else if (s.tx == null || clock >= s.next || Math.hypot(s.tx - s.x, s.ty - s.y) < 1.5) {
        s.tx = rand(sc.xMin + 1, sc.xMax - w - 1);
        s.ty = ground ? yMax : rand(yMin, Math.max(yMin, yMax));
        s.next = clock + rand(ground ? 2.5 : 2, ground ? 7 : 5);
        if (ground && Math.random() < 0.4) { s.tx = s.x; s.next = clock + rand(1.5, 4); } // stop and look around
      }

      const dx = s.tx - s.x;
      const dy = ground ? 0 : s.ty - s.y;
      const dist = Math.hypot(dx, dy);
      const stepLen = speed * dt;
      const moving = dist > 0.6;
      if (moving) {
        const k = Math.min(1, stepLen / dist);
        s.x += dx * k;
        s.y += dy * k;
        s.phase += dt * (mode === 'hop' ? 9 : 6);
      }
      if (Math.abs(dx) > 0.8) s.dir = dx > 0 ? 1 : -1;
      s.x = Math.max(sc.xMin, Math.min(sc.xMax - w, s.x));
      s.y = ground ? yMax : Math.max(yMin, Math.min(yMax, s.y));

      // Eat a pellet that is close enough.
      for (let i = pellets.length - 1; i >= 0; i--) {
        const p = pellets[i];
        if (Math.abs(p.x - (s.x + w / 2)) <= w / 2 + 1 && Math.abs(p.y - (s.y + h / 2)) <= h / 2 + 2) {
          pellets.splice(i, 1);
          const before = stageOf(f);
          f.eaten++;
          f.fed = now;
          dirty = true;
          if (stageOf(f) !== before) hooks.toast(`${f.name ? f.name : 'Your ' + sp.name} grew up a little!`);
          break;
        }
      }
    });

    // Aquarium: bubbles from the pump, air stones and the treasure chest, plus the odd random one.
    if (state.habitat === 'aquarium') {
      const emit = (x, y, rate) => { if (Math.random() < dt * rate && bubbles.length < 48) bubbles.push({ x: x + rand(-1, 1), y, v: rand(12, 24), wob: rand(0, 6) }); };
      if (state.enclosure === 'cube') emit(sc.xMax + 2.5, sc.floor - 3, 7); // the pump's air stone
      else emit(rand(10, sc.w - 10), sc.floor - 2, 0.8);
      for (const p of placedDecos(sc)) {
        if (p.d.id === 'airstone') emit(p.x + 3, p.y - 1, 6);
        if (p.d.id === 'chest' && clock >= chestNext) { for (let i = 0; i < 5; i++) bubbles.push({ x: p.x + 5 + rand(-2, 2), y: p.y - 1 - i * 2, v: rand(14, 22), wob: rand(0, 6) }); chestNext = clock + rand(5, 9); }
      }
      for (let i = bubbles.length - 1; i >= 0; i--) { bubbles[i].y -= bubbles[i].v * dt; if (bubbles[i].y < sc.yMin) bubbles.splice(i, 1); }
    }

    if (dirty) changed();
  }

  /* ---- drawing ---- */

  const spriteCache = new Map();

  /** One species/stage as a tiny offscreen canvas, built once. */
  function sprite(habId, spId, stage) {
    const key = habId + '|' + spId + '|' + stage;
    let cv = spriteCache.get(key);
    if (cv) return cv;
    const sp = HABITATS[habId].species.find((s) => s.id === spId) || HABITATS[habId].species[0];
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
        let col = ch === 'e' ? EYE : ch === 't' ? (sp.c.t || sp.c.f) : sp.c[ch];
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

  /** A decoration as an offscreen canvas. */
  function decoSprite(d) {
    const key = 'deco|' + d.id;
    let cv = spriteCache.get(key);
    if (cv) return cv;
    const w = d.rows[0].length;
    cv = document.createElement('canvas');
    cv.width = w;
    cv.height = d.rows.length;
    const g = cv.getContext('2d');
    d.rows.forEach((row, y) => {
      for (let x = 0; x < w; x++) {
        if (row[x] === '.') continue;
        g.fillStyle = d.c[row[x]];
        g.fillRect(x, y, 1, 1);
      }
    });
    spriteCache.set(key, cv);
    return cv;
  }

  const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

  function drawClassic(ctx, sc) {
    ctx.fillStyle = '#1d4a5e'; ctx.fillRect(0, 0, sc.w, 26);
    ctx.fillStyle = '#194152'; ctx.fillRect(0, 26, sc.w, 26);
    ctx.fillStyle = '#15394a'; ctx.fillRect(0, 52, sc.w, sc.h - 52);
    ctx.fillStyle = '#c9b27c'; ctx.fillRect(0, sc.floor, sc.w, sc.h - sc.floor);
    ctx.fillStyle = '#dcc790'; ctx.fillRect(0, sc.floor, sc.w, 1);
    ctx.fillStyle = '#a8935f';
    for (let x = 3; x < sc.w; x += 5) ctx.fillRect(x + ((x * 7) % 3), sc.floor + 3 + ((x * 13) % 7), 1, 1);
    if (!state.decos.length) { // a bare tank still gets a little seaweed and a rock
      const sway = Math.floor(clock * 2) % 2;
      ctx.fillStyle = '#2f8f4e';
      [[10, 14], [17, 9], [98, 13], [108, 8]].forEach(([x, hgt]) => { for (let i = 0; i < hgt; i++) ctx.fillRect(x + (i > hgt / 2 ? sway : 0), sc.floor - 1 - i, 2, 1); });
      ctx.fillStyle = '#7a8088'; ctx.fillRect(54, sc.floor - 3, 8, 4); ctx.fillRect(56, sc.floor - 5, 4, 2);
    }
  }

  /** A realistic square glass tank: lid with LED strip, glass walls, gravel, and an air pump feeding an air stone. */
  function drawCube(ctx, sc) {
    ctx.fillStyle = '#161a21'; ctx.fillRect(0, 0, sc.w, sc.h);                       // the room behind the glass
    ctx.fillStyle = '#1f5a73'; ctx.fillRect(3, 8, sc.w - 6, 26);                       // water, in three bands
    ctx.fillStyle = '#1b4d63'; ctx.fillRect(3, 34, sc.w - 6, 28);
    ctx.fillStyle = '#164256'; ctx.fillRect(3, 62, sc.w - 6, sc.floor - 62);
    ctx.fillStyle = '#7fc4de'; ctx.fillRect(3, 8, sc.w - 6, 1);                        // water surface
    const g = ctx.fillStyle;
    ctx.fillStyle = '#b9a98a'; ctx.fillRect(3, sc.floor, sc.w - 6, sc.h - 4 - sc.floor); // gravel
    const speck = ['#8c7d62', '#d8cba8', '#a2b5c4', '#c27c5c'];
    for (let y = sc.floor; y < sc.h - 4; y++) for (let x = 3; x < sc.w - 3; x++) { const hh = hash(x, y); if (hh % 7 === 0) { ctx.fillStyle = speck[hh % 4]; ctx.fillRect(x, y, 1, 1); } }
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(7, 14, 1, 36); ctx.fillRect(9, 20, 1, 14); // glass reflection
    ctx.fillStyle = 'rgba(190,225,240,0.35)'; ctx.fillRect(0, 6, 3, sc.h - 10); ctx.fillRect(sc.w - 3, 6, 3, sc.h - 10); // side panes
    ctx.fillStyle = '#0d0f13'; ctx.fillRect(0, 0, sc.w, 6); ctx.fillRect(0, sc.h - 4, sc.w, 4); // lid and base
    ctx.fillStyle = '#9fdcff'; ctx.fillRect(8, 4, sc.w - 28, 1);                       // LED strip
    ctx.fillStyle = 'rgba(159,220,255,0.08)'; ctx.fillRect(3, 6, sc.w - 6, 10);        // its glow on the water
    // air pump on the lid, tube down the right wall to the air stone
    ctx.fillStyle = '#3b3f47'; ctx.fillRect(sc.w - 18, 0, 12, 6);
    ctx.fillStyle = Math.floor(clock * 2) % 2 ? '#3ddc84' : '#1c6b42'; ctx.fillRect(sc.w - 9, 2, 2, 2); // blinking power light
    ctx.fillStyle = 'rgba(207,216,220,0.85)'; ctx.fillRect(sc.w - 7, 6, 1, sc.floor - 8);
    ctx.fillStyle = '#78828c'; ctx.fillRect(sc.w - 10, sc.floor - 2, 5, 2);
    ctx.fillStyle = g;
  }

  function drawJungle(ctx, sc) {
    ctx.fillStyle = '#9bd6a0'; ctx.fillRect(0, 0, sc.w, 26);
    ctx.fillStyle = '#7cc58a'; ctx.fillRect(0, 26, sc.w, 22);
    ctx.fillStyle = '#5eb374'; ctx.fillRect(0, 48, sc.w, sc.floor - 48);
    ctx.fillStyle = '#4a9a5c'; // far trees
    for (let x = -4; x < sc.w; x += 15) { const hgt = 16 + (x * 7) % 11; ctx.fillRect(x, sc.floor - hgt, 12, hgt); ctx.fillRect(x + 2, sc.floor - hgt - 3, 8, 3); }
    ctx.fillStyle = '#2f7a45'; // canopy along the top
    for (let x = 0; x < sc.w; x += 5) { const hgt = 6 + ((x * 11) % 9); ctx.fillRect(x, 0, 6, hgt); ctx.fillRect(x + 1, hgt, 4, 1); }
    ctx.fillStyle = '#1f6b3a';
    for (let x = 2; x < sc.w; x += 9) ctx.fillRect(x, 0, 5, 4 + ((x * 5) % 6));
    // tree trunks at both edges, with bark stripes and a branch
    for (const tx of [3, sc.w - 11]) {
      ctx.fillStyle = '#6b4423'; ctx.fillRect(tx, 0, 8, sc.floor);
      ctx.fillStyle = '#4e3219'; for (let y = 3; y < sc.floor; y += 7) ctx.fillRect(tx + 1 + (y % 3) * 2, y, 2, 4);
      ctx.fillStyle = '#6b4423'; ctx.fillRect(tx < 50 ? tx + 8 : tx - 10, 22, 10, 3);
      ctx.fillStyle = '#2f7a45'; ctx.fillRect(tx < 50 ? tx + 14 : tx - 12, 18, 6, 4);
    }
    // swaying vines
    ctx.fillStyle = '#2d8a4a';
    [[30, 26], [57, 34], [88, 28]].forEach(([vx, len]) => {
      for (let i = 0; i < len; i++) ctx.fillRect(vx + Math.round(Math.sin(clock * 1.4 + vx + i * 0.25) * (1 + i / 14)), 4 + i, 1, 1);
      ctx.fillStyle = '#58b968'; ctx.fillRect(vx - 1, len + 3, 3, 2); ctx.fillStyle = '#2d8a4a';
    });
    // ground: grass, soil, a few flowers and mushrooms
    ctx.fillStyle = '#3f8f3a'; ctx.fillRect(0, sc.floor, sc.w, 3);
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(0, sc.floor + 3, sc.w, sc.h - sc.floor - 3);
    ctx.fillStyle = '#4d3420'; for (let x = 2; x < sc.w; x += 6) ctx.fillRect(x + ((x * 5) % 4), sc.floor + 5 + ((x * 3) % 6), 2, 1);
    ctx.fillStyle = '#58b968'; for (let x = 1; x < sc.w; x += 4) ctx.fillRect(x, sc.floor - 1 - ((x * 7) % 3 === 0 ? 1 : 0), 1, 1);
    [[22, '#ff6f91'], [47, '#ffd23f'], [75, '#ff6f91'], [101, '#b388ff']].forEach(([fx, col]) => { ctx.fillStyle = col; ctx.fillRect(fx, sc.floor - 3, 2, 2); ctx.fillStyle = '#2f8f4e'; ctx.fillRect(fx, sc.floor - 1, 1, 1); });
    ctx.fillStyle = '#d9363e'; ctx.fillRect(64, sc.floor - 3, 5, 2); ctx.fillStyle = '#f5e8d0'; ctx.fillRect(66, sc.floor - 1, 1, 1); // a mushroom
    // fireflies
    ctx.fillStyle = '#fff3a0';
    for (let i = 0; i < 6; i++) {
      if (Math.sin(clock * 2 + i * 1.7) < 0.1) continue; // blinking
      ctx.fillRect(Math.round(20 + i * 16 + Math.sin(clock * 0.7 + i) * 8), Math.round(34 + Math.cos(clock * 0.9 + i * 2) * 10), 1, 1);
    }
  }

  function draw(ctx) {
    const sc = sceneNow();
    ctx.imageSmoothingEnabled = false;
    if (state.habitat === 'jungle') drawJungle(ctx, sc);
    else if (state.enclosure === 'cube') drawCube(ctx, sc);
    else drawClassic(ctx, sc);

    if (state.habitat === 'aquarium') {
      for (const p of placedDecos(sc)) { // decorations sit behind the fish
        const img = decoSprite(p.d);
        if (p.d.sway) {
          const sw = Math.round(Math.sin(clock * 1.6 + p.x) * 1);
          for (let r = 0; r < img.height; r++) ctx.drawImage(img, 0, r, img.width, 1, p.x + (r < img.height * 0.6 ? sw : 0), p.y + r, img.width, 1);
        } else ctx.drawImage(img, p.x, p.y);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      bubbles.forEach((b) => ctx.fillRect(Math.round(b.x + Math.sin(clock * 3 + b.wob) * 0.8), Math.round(b.y), 1, 1));
    }

    ctx.fillStyle = state.habitat === 'jungle' ? '#d9363e' : '#e9a05a'; // food
    pellets.forEach((p) => ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2));

    const now = Date.now();
    pets().forEach((f, i) => {
      const s = simFor(f);
      const sp = speciesOf(f.sp);
      const img = sprite(state.habitat, f.sp, stageOf(f));
      let y = s.y;
      if (sp.mode === 'swim') y += Math.sin(clock * 3 + i) * 0.8;
      else if (sp.mode === 'fly') y += Math.sin(clock * 6 + i) * 1.2;
      else if (sp.mode === 'hop') y -= Math.abs(Math.sin(s.phase)) * 4;
      else y -= Math.abs(Math.sin(s.phase)) * 0.8; // a little walking bob
      y = Math.round(y);
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

  /* ---- frame auto-hide: the title bar, buttons and border fade away while the mouse is elsewhere ---- */

  let autoHide = true;
  let hideTimer = null;
  let dragging = false;
  const HIDE_AFTER = 3000;

  function revealFrame() {
    clearTimeout(hideTimer);
    if (el) el.tank.classList.remove('bare');
  }

  /** Start the countdown to hiding the frame, unless something needs it visible. */
  function scheduleHide() {
    clearTimeout(hideTimer);
    if (!el || !autoHide || !state.open) return;
    hideTimer = setTimeout(() => {
      const busy = state.min || !el.shop.hidden || dragging || el.tank.matches(':hover') || el.tank.contains(document.activeElement);
      if (!busy) el.tank.classList.add('bare');
    }, HIDE_AFTER);
  }

  function setAutoHide(on) {
    autoHide = !!on;
    if (!autoHide) revealFrame(); else scheduleHide();
  }

  const running = () => enabled && state.open && !state.min && !document.hidden;

  /** Run the redraw loop only while the box is actually visible. */
  function syncLoop() {
    if (running()) {
      if (!loop) { last = performance.now(); loop = setInterval(tick, 100); }
    } else if (loop) { clearInterval(loop); loop = null; }
  }

  let hoverPet = null; // the pet under the mouse, if any

  /** Show the hovered pet's name above it (and keep it following as the pet moves). */
  function updateTip() {
    const tip = el.petTip;
    if (!hoverPet || !pets().includes(hoverPet)) { hoverPet = null; tip.hidden = true; return; }
    const s = sims.get(hoverPet.id);
    if (!s) { tip.hidden = true; return; }
    const [w] = spriteSize(hoverPet);
    tip.textContent = hoverPet.name ? `${hoverPet.name} · ${speciesOf(hoverPet.sp).name}` : speciesOf(hoverPet.sp).name;
    tip.hidden = false;
    tip.style.left = el.canvas.offsetLeft + (s.x + w / 2) * SCALE + 'px';
    tip.style.top = el.canvas.offsetTop + s.y * SCALE - 4 + 'px';
  }

  function tick() {
    const t = performance.now();
    const dt = Math.min(0.25, (t - last) / 1000);
    last = t;
    step(dt);
    draw(el.ctx);
    if (hoverPet) updateTip();
    if (++uiTick % 10 === 0) renderFeed();
  }

  const mmss = (ms) => `${Math.max(1, Math.ceil(ms / 60000))} min`;

  /** The food meter: one segment per stored charge, the next one filling up as time passes. */
  function renderFeed() {
    if (!el) return;
    const n = refreshFood();
    const f = foodOf();
    const frac = n < FOOD_MAX ? Math.max(0, Math.min(1, (Date.now() - f.t) / FOOD_EVERY)) : 0;
    el.foodSegs.innerHTML = Array.from({ length: FOOD_MAX }, (_, i) => {
      const w = i < n ? 100 : i === n ? Math.round(frac * 100) : 0;
      return `<span class="food-seg${i === n && n < FOOD_MAX ? ' partial' : ''}"><i style="width:${w}%"></i></span>`;
    }).join('');
    const word = hab().foodWord;
    el.foodHint.textContent = !pets().length ? 'Buy a pet first' : n > 0 ? `Click the scene to drop ${word}` : `Next ${word} in ${mmss(FOOD_EVERY - (Date.now() - f.t))}`;
    el.foodSegs.parentElement.title = `${n} of ${FOOD_MAX} ${word} ready. One comes back every 30 minutes.`;
  }

  /** Size the canvas for the current scene and set the title. */
  function applyScene() {
    const sc = sceneNow();
    el.canvas.width = sc.w;
    el.canvas.height = sc.h;
    el.canvas.style.width = sc.w * SCALE + 'px';
    el.canvas.style.height = sc.h * SCALE + 'px';
    el.title.textContent = hab().title;
    el.ctx = el.canvas.getContext('2d');
  }

  function renderUi() {
    if (!el) return;
    el.pearls.textContent = pearls();
    renderFeed();
    if (!el.shop.hidden) renderShop();
  }

  /** Shop panel: quests, pets to buy, your pets (with Release), and the aquarium's enclosure and decorations. */
  function renderShop() {
    const h = hab();
    const list = pets();
    const full = list.length >= MAX_PETS;
    const toNext = TIME_PEARL - (totalTracked % TIME_PEARL);
    let html = `<p class="shop-line"><b>${pearls()}</b> pearls · ${list.length}/${MAX_PETS} ${h.plural}</p>`;
    html += '<p class="shop-quest">Quests: finish a step = 1 pearl. Every 30 min tracked = 1 pearl'
      + ` (next in ${mmss(toNext)}). Pearls are shared with the other habitat.</p><h4>Buy ${h.one}</h4>`;
    if (full) html += `<p class="shop-note">It is full. Release ${h.one === 'a fish' ? 'a fish' : 'an animal'} to make room.</p>`;
    html += h.species.map((sp) => {
      const can = !full && pearls() >= sp.price;
      return `<div class="sp"><canvas class="prev" data-sp="${sp.id}" width="16" height="12"></canvas>`
        + `<span class="sp-name">${sp.name}<small class="r-${sp.rarity.toLowerCase()}">${sp.rarity}</small></span>`
        + `<button type="button" data-buy="${sp.id}"${can ? '' : ' disabled'}>${sp.price} ●</button></div>`;
    }).join('');
    html += `<h4>Your ${h.plural}</h4>`;
    html += list.length ? list.map((f) => {
      const editing = renamingId === f.id;
      const label = editing
        ? `<input class="pname-in" data-name-for="${f.id}" maxlength="${MAX_NAME}" value="${esc(f.name || '')}" placeholder="Name your ${esc(speciesOf(f.sp).name.toLowerCase())}">`
        : `<b class="pname">${esc(petName(f))}</b>`;
      const sub = `${f.name ? esc(speciesOf(f.sp).name) + ' · ' : ''}${STAGE_NAME[stageOf(f)]} · ${f.eaten} fed`;
      return `<div class="sp"><canvas class="prev" data-sp="${f.sp}" data-stage="${stageOf(f)}" width="16" height="12"></canvas>`
        + `<span class="sp-name">${label}<small>${sub}</small></span>`
        + (editing ? '<button type="button" data-rename-ok="' + f.id + '">OK</button>'
          : `<button type="button" data-rename="${f.id}">Rename</button><button type="button" data-release="${f.id}">Release</button>`) + '</div>';
    }).join('')
      : `<p class="shop-note">No ${h.plural} yet.</p>`;

    if (state.habitat === 'aquarium') {
      html += '<h4>Enclosure</h4><div class="opts">' + ENCLOSURES.map((e) =>
        `<button type="button" class="opt${state.enclosure === e.id ? ' on' : ''}" data-encl="${e.id}"><b>${e.name}</b><small>${e.desc}</small></button>`).join('') + '</div>';
      html += '<h4>Decorations</h4>' + DECOS.map((d) => {
        const own = state.decos.find((x) => x.id === d.id);
        const action = own
          ? `<button type="button" data-deco-toggle="${d.id}">${own.hide ? 'Show' : 'Hide'}</button>`
          : `<button type="button" data-deco-buy="${d.id}"${pearls() >= d.price ? '' : ' disabled'}>${d.price} ●</button>`;
        return `<div class="sp"><canvas class="prev" data-deco="${d.id}" width="${d.rows[0].length}" height="${d.rows.length}" style="width:${d.rows[0].length * 3}px;height:${d.rows.length * 3}px"></canvas>`
          + `<span class="sp-name">${d.name}<small>${d.desc}</small></span>${action}</div>`;
      }).join('');
    }
    el.shop.innerHTML = html;
    el.shop.querySelectorAll('canvas.prev').forEach((cv) => {
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      if (cv.dataset.deco) { g.drawImage(decoSprite(decoById(cv.dataset.deco)), 0, 0); return; }
      const img = sprite(state.habitat, cv.dataset.sp, cv.dataset.stage || 'adult');
      g.drawImage(img, Math.floor((cv.width - img.width) / 2), Math.floor((cv.height - img.height) / 2));
    });
  }

  function place(x, y) {
    const r = el.tank.getBoundingClientRect();
    el.tank.style.left = Math.max(0, Math.min(root.innerWidth - r.width, x)) + 'px';
    el.tank.style.top = Math.max(0, Math.min(root.innerHeight - r.height, y)) + 'px';
  }

  function show() {
    if (!enabled) return;
    state.open = true;
    el.tank.hidden = false;
    el.tank.classList.toggle('min', state.min);
    applyScene();
    const starterDone = state.habitat === 'jungle' ? state.jungle.starter : state.starter;
    if (!starterDone) { // everyone gets a first pet in each habitat
      if (state.habitat === 'jungle') state.jungle.starter = true; else state.starter = true;
      pets().push({ id: newId(), sp: hab().starter, eaten: 0, fed: Date.now() });
      hooks.toast(hab().starterMsg);
    }
    const r = el.tank.getBoundingClientRect();
    const p = state.pos || { x: root.innerWidth - r.width - 20, y: root.innerHeight - r.height - 20 };
    place(p.x, p.y);
    changed();
    syncLoop();
    revealFrame();
    scheduleHide();
  }

  function hide() {
    state.open = false;
    clearTimeout(hideTimer);
    if (el) el.tank.hidden = true;
    save();
    syncLoop();
  }

  /** Settings: 'off' | 'aquarium' | 'jungle'. Switching habitats keeps each one's pets; pearls are shared. */
  function setCompanion(mode) {
    if (mode === 'off') { enabled = false; if (el && state.open) hide(); return; }
    enabled = true;
    if (!HABITATS[mode] || state.habitat === mode) return;
    state.habitat = mode;
    resetScene();
    save();
    hooks.onChange(pearls(), hab().title);
    if (el) {
      el.shop.hidden = true;
      el.shopBtn.textContent = 'Shop';
      applyScene();
      if (state.open) { show(); } else renderUi();
    }
  }

  const setEnabled = (on) => setCompanion(on ? state.habitat : 'off');

  function toggle() {
    if (!enabled) return;
    if (state.open) hide(); else show();
  }

  /** Wire the box markup (#tank etc. in index.html). hooks = { toast(msg), onChange(pearls, title) }. */
  function init(h) {
    hooks = Object.assign(hooks, h);
    const $ = (id) => document.getElementById(id);
    el = {
      tank: $('tank'), head: $('tankHead'), canvas: $('tankCanvas'), pearls: $('tankPearls'), title: $('tankTitle'), petTip: $('petTip'),
      foodSegs: $('foodSegs'), foodHint: $('foodHint'), shopBtn: $('shopBtn'), shop: $('tankShop'), min: $('tankMin'), close: $('tankClose'),
    };
    el.ctx = el.canvas.getContext('2d');
    applyScene();

    el.head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.tank.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      el.head.setPointerCapture(e.pointerId);
      dragging = true;
      const move = (ev) => place(ev.clientX - ox, ev.clientY - oy);
      const up = () => {
        el.head.removeEventListener('pointermove', move);
        el.head.removeEventListener('pointerup', up);
        el.head.removeEventListener('pointercancel', up);
        dragging = false;
        const b = el.tank.getBoundingClientRect();
        state.pos = { x: b.left, y: b.top };
        save();
        scheduleHide();
      };
      el.head.addEventListener('pointercancel', up);
      el.head.addEventListener('pointermove', move);
      el.head.addEventListener('pointerup', up);
    });

    // Click the scene to feed right there.
    el.canvas.addEventListener('click', (e) => {
      const r = el.canvas.getBoundingClientRect();
      feedAt((e.clientX - r.left) / SCALE, (e.clientY - r.top) / SCALE);
    });
    // The Shop button flips between the shop and the scene; its label says where you'll go.
    el.shopBtn.onclick = () => {
      el.shop.hidden = !el.shop.hidden;
      el.shopBtn.textContent = el.shop.hidden ? 'Shop' : 'Back';
      hoverAt = null;
      if (!el.shop.hidden) renderShop();
      revealFrame();
      scheduleHide();
    };
    el.close.onclick = hide;
    el.min.onclick = () => {
      state.min = !state.min;
      el.tank.classList.toggle('min', state.min);
      save();
      syncLoop();
      revealFrame();
      scheduleHide();
    };

    // Hovering the box brings the frame back at once; leaving starts the 3 second countdown.
    el.tank.addEventListener('pointerenter', revealFrame);
    el.tank.addEventListener('pointerleave', scheduleHide);
    el.tank.addEventListener('focusin', revealFrame);
    el.tank.addEventListener('focusout', scheduleHide);
    // Naming: Rename opens a box in the list; Enter / OK / clicking away saves, Esc cancels.
    const commitRename = () => {
      if (!renamingId) return;
      const id = renamingId;
      const box = el.shop.querySelector('.pname-in');
      renamingId = null;
      if (box) setPetName(id, box.value);
      changed();
    };
    el.shop.addEventListener('keydown', (e) => {
      if (!e.target.classList.contains('pname-in')) return;
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      else if (e.key === 'Escape') { e.stopPropagation(); renamingId = null; renderShop(); }
    });
    el.shop.addEventListener('focusout', (e) => { if (e.target.classList.contains('pname-in')) setTimeout(commitRename, 0); });

    el.shop.addEventListener('click', (e) => {
      const rn = e.target.closest('[data-rename]');
      if (rn) {
        renamingId = rn.dataset.rename;
        renderShop();
        const box = el.shop.querySelector('.pname-in');
        if (box) { box.focus(); box.select(); }
        return;
      }
      if (e.target.closest('[data-rename-ok]')) { commitRename(); return; }
      const b = e.target.closest('[data-buy]');
      if (b) { buy(b.dataset.buy); return; }
      const r = e.target.closest('[data-release]');
      if (r) { release(r.dataset.release); return; }
      const enc = e.target.closest('[data-encl]');
      if (enc) { setEnclosure(enc.dataset.encl); applyScene(); return; }
      const db = e.target.closest('[data-deco-buy]');
      if (db) { buyDeco(db.dataset.decoBuy); return; }
      const dt = e.target.closest('[data-deco-toggle]');
      if (dt) toggleDeco(dt.dataset.decoToggle);
    });

    // Hover a pet in the scene to see its name.
    el.canvas.addEventListener('pointermove', (e) => {
      const r = el.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / SCALE;
      const y = (e.clientY - r.top) / SCALE;
      hoverAt = { x, y };
      hoverPet = null;
      for (const f of pets().slice().reverse()) {
        const s = sims.get(f.id);
        if (!s) continue;
        const [w, h] = spriteSize(f);
        if (x >= s.x - 2 && x <= s.x + w + 2 && y >= s.y - 4 && y <= s.y + h + 4) { hoverPet = f; break; }
      }
      updateTip();
    });
    el.canvas.addEventListener('pointerleave', () => { hoverAt = null; hoverPet = null; updateTip(); });

    document.addEventListener('visibilitychange', syncLoop);
    root.addEventListener('resize', () => { if (state.open) { const b = el.tank.getBoundingClientRect(); place(b.left, b.top); } });

    hooks.onChange(pearls(), hab().title);
    if (state.open && enabled) show();
  }

  /** Read-only snapshot of where each pet is (scene pixels), for checking behaviour from the console. */
  function debugPets() {
    return pets().map((f) => {
      const s = sims.get(f.id);
      const [w, h] = spriteSize(f);
      return { name: petName(f), x: s ? s.x + w / 2 : null, y: s ? s.y + h / 2 : null, eaten: f.eaten, pellets: pellets.length };
    });
  }

  root.Aquarium = { init, toggle, setEnabled, setCompanion, setAutoHide, debugPets, stepDone, trackedTime, pearls, MAX_PETS, HABITATS: Object.keys(HABITATS) };
})(window);
