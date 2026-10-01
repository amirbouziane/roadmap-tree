/* Whiteboard tab: a corkboard with pinned sticky notes, one per project plus a
 * general one. Double-click the board (or "+ Note") to add a note; drag a note
 * by its top edge, resize from the corner, pick a colour, delete with the ×.
 *
 * Relies on app.js globals (loaded after this file, used only when called):
 * state, $, esc, NOTE_COLORS, newSmallId, markDirty, updateSaveState.
 */
const Board = (() => {
  let zTop = 0;
  let stop = null; // ends a drag in progress, if any

  const board = () => (state.boardScope === 'general' ? state.general : state.tree).board;

  function noteHtml(n) {
    return `<div class="sn c-${n.c}" data-id="${esc(n.id)}" style="${style(n)}">`
      + '<div class="sn-top"><i class="sn-pin"></i><span class="sn-tools">'
      + NOTE_COLORS.map((c) => `<button type="button" class="sn-dot c-${c}" data-c="${c}" title="${c}"></button>`).join('')
      + '<button type="button" class="sn-del" title="Delete note">×</button></span></div>'
      + `<textarea class="sn-text" spellcheck="false" placeholder="Write something…">${esc(n.t)}</textarea>`
      + '<i class="sn-resize" title="Drag to resize"></i></div>';
  }

  const style = (n) => `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;transform:rotate(${n.r}deg);z-index:${n.z}`;

  /** Make the scrollable canvas big enough to hold every note plus some room to grow. */
  function fitCanvas() {
    const c = $('board').firstElementChild;
    if (!c) return;
    let w = 0;
    let h = 0;
    for (const n of board().notes) { w = Math.max(w, n.x + n.w); h = Math.max(h, n.y + n.h); }
    c.style.minWidth = w + 320 + 'px';
    c.style.minHeight = h + 240 + 'px';
  }

  function render() {
    document.querySelectorAll('#boardScope button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.boardScope));
    const notes = board().notes;
    zTop = notes.reduce((m, n) => Math.max(m, n.z), 0);
    const empty = notes.length ? '' : '<p class="board-empty">'
      + (state.boardScope === 'general' ? 'This is your general board, shared by every project.' : 'This board belongs to this project.')
      + '<br>Double-click anywhere to pin your first note.</p>';
    $('board').innerHTML = `<div class="board-canvas">${notes.map(noteHtml).join('')}${empty}</div>`;
    fitCanvas();
  }

  function addNote(x, y) {
    const b = board();
    const n = {
      id: newSmallId('b'), x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), w: 180, h: 140,
      c: NOTE_COLORS[b.notes.length % NOTE_COLORS.length], r: +(Math.random() * 5 - 2.5).toFixed(1), z: ++zTop, t: '',
    };
    b.notes.push(n);
    markDirty();
    updateSaveState();
    render();
    const ta = $('board').querySelector(`.sn[data-id="${n.id}"] textarea`);
    if (ta) ta.focus();
  }

  /**
   * Track a pointer drag. onMove(dx, dy) gets the distance from the start;
   * the drag always ends cleanly on release, cancel, window blur or Escape.
   */
  function track(e, onMove, onEnd) {
    if (stop) stop();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev) => onMove(ev.clientX - x0, ev.clientY - y0);
    const finish = (keep) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      if (stop === cancel) stop = null;
      onEnd(keep);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev) => { if (ev.key === 'Escape') finish(false); };
    stop = cancel;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
  }

  const noteOf = (el) => {
    const g = el.closest('.sn');
    return g ? { g, n: board().notes.find((x) => x.id === g.dataset.id) } : {};
  };

  function init() {
    const el = $('board');
    let saveTimer = null;

    el.addEventListener('pointerdown', (e) => {
      const { g, n } = noteOf(e.target);
      if (!n || e.button !== 0) return;
      n.z = ++zTop; // clicked note comes to the front
      g.style.zIndex = n.z;

      if (e.target.closest('.sn-resize')) {
        e.preventDefault();
        const w0 = n.w;
        const h0 = n.h;
        track(e, (dx, dy) => {
          n.w = Math.min(600, Math.max(120, w0 + dx));
          n.h = Math.min(600, Math.max(90, h0 + dy));
          g.style.width = n.w + 'px';
          g.style.height = n.h + 'px';
        }, (keep) => {
          if (!keep) { n.w = w0; n.h = h0; g.style.width = w0 + 'px'; g.style.height = h0 + 'px'; }
          else { markDirty(); updateSaveState(); }
          fitCanvas();
        });
      } else if (e.target.closest('.sn-top') && !e.target.closest('button')) {
        e.preventDefault();
        const x0 = n.x;
        const y0 = n.y;
        g.classList.add('lifting');
        track(e, (dx, dy) => {
          n.x = Math.max(0, x0 + dx);
          n.y = Math.max(0, y0 + dy);
          g.style.left = n.x + 'px';
          g.style.top = n.y + 'px';
        }, (keep) => {
          g.classList.remove('lifting');
          if (!keep) { n.x = x0; n.y = y0; g.style.left = x0 + 'px'; g.style.top = y0 + 'px'; }
          else { markDirty(); updateSaveState(); }
          fitCanvas();
        });
      }
    });

    el.addEventListener('click', (e) => {
      const { g, n } = noteOf(e.target);
      if (!n) return;
      const dot = e.target.closest('.sn-dot');
      if (dot) {
        n.c = dot.dataset.c;
        g.className = g.className.replace(/\bc-\w+/, 'c-' + n.c);
        markDirty();
        updateSaveState();
      } else if (e.target.closest('.sn-del')) {
        if (n.t.trim() && !confirm('Delete this note?')) return;
        board().notes = board().notes.filter((x) => x.id !== n.id);
        markDirty();
        updateSaveState();
        render();
      }
    });

    el.addEventListener('input', (e) => {
      const { n } = noteOf(e.target);
      if (!n || !e.target.classList.contains('sn-text')) return;
      n.t = e.target.value;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { markDirty(); updateSaveState(); }, 250);
    });

    // Double-click empty board to add a note right there.
    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.sn')) return;
      const canvas = el.firstElementChild;
      const r = canvas.getBoundingClientRect();
      addNote(e.clientX - r.left - 90, e.clientY - r.top - 12);
    });

    $('boardAdd').onclick = () => {
      const n = board().notes.length;
      addNote(el.scrollLeft + 40 + (n % 6) * 28, el.scrollTop + 30 + (n % 6) * 28); // cascade so notes don't stack exactly
    };
    $('boardScope').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      state.boardScope = b.dataset.v;
      render();
    });
  }

  return { init, render };
})();
