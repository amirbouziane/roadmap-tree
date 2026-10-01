/* Calendar planner: book steps into the Morning, Afternoon or Evening of a day.
 *
 * - "Plan a step" books one step into one slot, on one day or repeated across
 *   a range of days (each day becomes its own block you can move or remove).
 * - The week grid shows every block; drag a block to another slot or day.
 * - A block whose slot has passed while its step is unfinished is "missed":
 *   it is listed with a suggested next free slot you accept in one click.
 *
 * Blocks live in each project's `blocks` array: { id, node, day, slot, done }.
 *
 * Relies on app.js globals (loaded after this file, used only when called):
 * state, $, esc, SLOTS, dayKey, dayStart, findNode, walk, statusOf, urgency,
 * fmtDays, newSmallId, markDirty, updateSaveState, toast, goToStep.
 */
const Planner = (() => {
  const HOUR = 3600000;
  let weekStart = null;   // 'YYYY-MM-DD' of the Monday being shown
  let prefill = null;     // { day, slot } set by a cell's "+" button
  let stopDrag = null;

  const slotById = (id) => SLOTS.find((s) => s.id === id);
  const addDays = (key, n) => { const d = new Date(dayStart(key)); d.setDate(d.getDate() + n); return dayKey(d); };

  function mondayOf(key) {
    const d = new Date(dayStart(key));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return dayKey(d);
  }

  const shortDay = (key) => new Date(dayStart(key)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  const longDay = (key) => new Date(dayStart(key)).toLocaleDateString(undefined, { weekday: 'long' });

  /** When a slot ends, in epoch ms. */
  function slotEnd(day, slotId) {
    return dayStart(day) + slotById(slotId).to * HOUR;
  }
  const slotStart = (day, slotId) => dayStart(day) + slotById(slotId).from * HOUR;

  /** 'done' | 'missed' | 'now' | 'planned' for a block of this project. */
  function statusOfBlock(tree, b, nowMs) {
    const hit = findNode(tree, b.node);
    if (b.done || !hit || statusOf(hit.node) === 'done') return 'done';
    if (slotEnd(b.day, b.slot) <= nowMs) return 'missed';
    if (slotStart(b.day, b.slot) <= nowMs) return 'now';
    return 'planned';
  }

  /**
   * The first slot that has not passed yet and holds no unfinished block.
   * Starts the search at `afterMs`. Returns { day, slot } or null.
   */
  function nextFreeSlot(tree, afterMs) {
    const taken = new Set(tree.blocks.filter((b) => statusOfBlock(tree, b, afterMs) !== 'done').map((b) => `${b.day}|${b.slot}`));
    const today = dayKey(afterMs);
    for (let i = 0; i < 60; i++) {
      const day = addDays(today, i);
      for (const s of SLOTS) {
        if (slotEnd(day, s.id) <= afterMs) continue; // already over
        if (!taken.has(`${day}|${s.id}`)) return { day, slot: s.id };
      }
    }
    return null;
  }

  const missedBlocks = (tree, nowMs) => tree.blocks.filter((b) => statusOfBlock(tree, b, nowMs) === 'missed');

  const labelOf = (tree, b) => { const h = findNode(tree, b.node); return h ? h.node.label : '(deleted step)'; };

  /** Pure: HTML for the whole planner section of the open project. */
  function html(tree, nowMs) {
    const today = dayKey(nowMs);
    weekStart = weekStart || mondayOf(today);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const options = [];
    walk(tree.nodes, (n, depth) => { if (statusOf(n) !== 'done') options.push(`<option value="${esc(n.id)}">${'  '.repeat(depth)}${esc(n.label)}</option>`); });
    const pf = prefill || { day: today, slot: 'am' };

    let out = '<h3>Plan <small>book steps into a morning, afternoon or evening</small></h3>';

    // Missed blocks first: they need a decision.
    const missed = missedBlocks(tree, nowMs).sort((a, b) => a.day.localeCompare(b.day));
    if (missed.length) {
      out += '<div class="plan-missed"><h4>Missed, needs a new slot</h4><ul>';
      for (const b of missed.slice(0, 6)) {
        const sug = nextFreeSlot(tree, nowMs);
        const hit = findNode(tree, b.node);
        const late = sug && hit && hit.node.due && sug.day > hit.node.due;
        out += `<li data-id="${esc(b.id)}"><span class="pm-what"><b>${esc(labelOf(tree, b))}</b> `
          + `<small>was ${esc(longDay(b.day))} ${esc(slotById(b.slot).label.toLowerCase())}</small></span><span class="pm-actions">`
          + (sug ? `<button type="button" class="primary" data-act="resched" data-day="${sug.day}" data-slot="${sug.slot}" title="Move this block">`
            + `Move to ${esc(sug.day === today ? 'today' : sug.day === addDays(today, 1) ? 'tomorrow' : longDay(sug.day))} ${esc(slotById(sug.slot).label.toLowerCase())}</button>` : '')
          + '<button type="button" data-act="donehere">Already done</button><button type="button" data-act="skip" title="Remove this block">Skip</button></span>'
          + (late ? '<small class="pm-warn">That is after this step\'s target date.</small>' : '') + '</li>';
      }
      out += '</ul></div>';
    }

    out += '<form class="plan-form" id="planForm">'
      + `<select name="node" required>${options.length ? options.join('') : '<option value="">No unfinished steps</option>'}</select>`
      + `<select name="slot">${SLOTS.map((s) => `<option value="${s.id}"${s.id === pf.slot ? ' selected' : ''}>${s.label}</option>`).join('')}</select>`
      + `<label>from <input type="date" name="from" value="${pf.day}" required></label>`
      + '<label>to <input type="date" name="until" title="Optional: repeat on every day up to this one"></label>'
      + '<button type="submit"' + (options.length ? '' : ' disabled') + '>Add to plan</button></form>';

    out += '<div class="plan-nav"><button type="button" data-nav="-1" aria-label="Previous week">‹</button>'
      + `<span class="plan-range">${esc(shortDay(days[0]))} – ${esc(shortDay(days[6]))}</span>`
      + '<button type="button" data-nav="1" aria-label="Next week">›</button><button type="button" data-nav="0">This week</button></div>';

    out += '<div class="plan-grid"><div class="pcorner"></div>'
      + days.map((d) => `<div class="phead${d === today ? ' today' : ''}">${esc(shortDay(d))}</div>`).join('');
    for (const s of SLOTS) {
      out += `<div class="pslot">${s.label}</div>`;
      for (const d of days) {
        const blocks = tree.blocks.filter((b) => b.day === d && b.slot === s.id);
        const over = slotEnd(d, s.id) <= nowMs;
        out += `<div class="pcell${d === today ? ' today' : ''}${over ? ' over' : ''}" data-day="${d}" data-slot="${s.id}">`
          + blocks.map((b) => {
            const st = statusOfBlock(tree, b, nowMs);
            return `<div class="pb st-${st}" data-id="${esc(b.id)}" title="${esc(labelOf(tree, b))}">`
              + `<span class="pb-label">${esc(labelOf(tree, b))}</span>`
              + `<span class="pb-tools"><button type="button" data-act="tick" title="${st === 'done' ? 'Mark not done' : 'Mark done'}">✓</button>`
              + '<button type="button" data-act="remove" title="Remove from plan">×</button></span></div>';
          }).join('')
          + `<button type="button" class="padd" data-act="add" title="Plan a step here">+</button></div>`;
      }
    }
    return out + '</div>';
  }

  function render() {
    const el = $('plannerView');
    if (!el) return;
    el.innerHTML = html(state.tree, Date.now());
  }

  /** "Planned today" lines for the project sidebar. */
  function todayHtml(tree) {
    const nowMs = Date.now();
    const today = dayKey(nowMs);
    const items = tree.blocks.filter((b) => b.day === today)
      .sort((a, b) => SLOTS.findIndex((s) => s.id === a.slot) - SLOTS.findIndex((s) => s.id === b.slot));
    if (!items.length) return '';
    return '<h3>Planned today</h3><ul class="plan-today">' + items.map((b) => {
      const st = statusOfBlock(tree, b, nowMs);
      return `<li class="st-${st}" data-id="${esc(b.node)}"><span class="pt-slot">${esc(slotById(b.slot).label)}</span>`
        + `<span class="pt-label">${esc(labelOf(tree, b))}</span></li>`;
    }).join('') + '</ul>';
  }

  /** How many blocks across all projects were missed (for the launch notice). */
  function missedCount() {
    const nowMs = Date.now();
    return state.projects.reduce((n, p) => n + missedBlocks(p, nowMs).length, 0);
  }

  function changed() {
    markDirty();
    updateSaveState();
    render();
    if (typeof update === 'function') update();
  }

  /** Move a block to another day/slot while dragging; returns true if it moved. */
  function moveBlock(b, day, slot) {
    if (b.day === day && b.slot === slot) return false;
    b.day = day;
    b.slot = slot;
    return true;
  }

  function startDrag(e, blockId) {
    if (stopDrag) stopDrag();
    const grid = $('plannerView');
    const x0 = e.clientX;
    const y0 = e.clientY;
    const b = state.tree.blocks.find((x) => x.id === blockId);
    if (!b) return;
    let active = false;
    let target = null;
    const clear = () => grid.querySelectorAll('.pcell.drop').forEach((c) => c.classList.remove('drop'));
    const move = (ev) => {
      if (!active) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        active = true;
        document.body.classList.add('is-dragging');
        const chip = grid.querySelector(`.pb[data-id="${CSS.escape(blockId)}"]`);
        if (chip) chip.classList.add('dragging');
      }
      clear();
      const cell = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList && n.classList.contains('pcell'));
      target = cell ? { day: cell.dataset.day, slot: cell.dataset.slot } : null;
      if (cell) cell.classList.add('drop');
    };
    const finish = (keep) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      if (stopDrag === cancel) stopDrag = null;
      if (!active) return;
      clear();
      document.body.classList.remove('is-dragging');
      const swallow = (ev) => ev.stopPropagation();
      document.addEventListener('click', swallow, true);
      setTimeout(() => document.removeEventListener('click', swallow, true), 60);
      if (keep && target && moveBlock(b, target.day, target.slot)) changed(); else render();
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev) => { if (ev.key === 'Escape') finish(false); };
    stopDrag = cancel;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
  }

  function init() {
    const el = $('plannerView');

    el.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) {
        const n = Number(nav.dataset.nav);
        weekStart = n === 0 ? mondayOf(dayKey(Date.now())) : addDays(weekStart, n * 7);
        render();
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const tree = state.tree;
      const chip = act.closest('.pb');
      const miss = act.closest('.plan-missed li');
      const block = tree.blocks.find((x) => x.id === (chip ? chip.dataset.id : miss ? miss.dataset.id : null));
      switch (act.dataset.act) {
        case 'add': { // prefill the form from the cell's day and slot
          const cell = act.closest('.pcell');
          prefill = { day: cell.dataset.day, slot: cell.dataset.slot };
          render();
          const f = $('planForm');
          if (f) { f.node.focus(); f.scrollIntoView({ block: 'nearest' }); }
          break;
        }
        case 'tick': if (block) { block.done = !block.done; changed(); } break;
        case 'remove': case 'skip':
          if (block) { tree.blocks = tree.blocks.filter((x) => x.id !== block.id); changed(); }
          break;
        case 'donehere': if (block) { block.done = true; changed(); } break;
        case 'resched':
          if (block) { moveBlock(block, act.dataset.day, act.dataset.slot); changed(); toast('Moved to a free slot'); }
          break;
      }
    });

    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.id !== 'planForm' || !f.node.value) return;
      const from = f.from.value;
      let until = f.until.value || from;
      if (until < from) until = from;
      const tree = state.tree;
      let added = 0;
      for (let d = from, guard = 0; d <= until && guard < 62; d = addDays(d, 1), guard++) {
        if (tree.blocks.some((b) => b.node === f.node.value && b.day === d && b.slot === f.slot.value)) continue;
        tree.blocks.push({ id: newSmallId('k'), node: f.node.value, day: d, slot: f.slot.value, done: false });
        added++;
      }
      prefill = null;
      weekStart = mondayOf(from);
      changed();
      toast(added ? `Planned ${added} block${added > 1 ? 's' : ''}` : 'Already planned');
    });

    el.addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.pb');
      if (!chip || e.button !== 0 || e.target.closest('button')) return;
      startDrag(e, chip.dataset.id);
    });
  }

  return { init, render, todayHtml, missedCount, html, nextFreeSlot, statusOfBlock, mondayOf };
})();
