/* Library tab: important links, kept per project or in a shared "General" shelf.
 *
 * Passwords are deliberately not stored here: project files are plain text,
 * so a password in them would be readable by anyone with the file.
 *
 * Relies on app.js globals (loaded after this file, used only when called):
 * state, $, esc, cleanUrl, newSmallId, markDirty, toast.
 */
const Library = (() => {
  let editing = null; // id of the link being edited, or 'new'
  let filter = '';

  const shelf = () => (state.libScope === 'general' ? state.general : state.tree);

  /** "example.com" for display. */
  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url; }
  }

  function formHtml(l) {
    return `<form class="lk-form" data-id="${esc(l.id)}">`
      + `<input name="title" placeholder="Title, e.g. Holiday form" value="${esc(l.title)}" maxlength="200">`
      + `<input name="url" placeholder="https://…" value="${esc(l.url)}" required>`
      + `<input name="note" placeholder="Note (optional)" value="${esc(l.note)}" maxlength="500">`
      + `<div class="lk-form-actions"><button type="submit" class="primary">Save</button>`
      + `<button type="button" data-act="cancel">Cancel</button></div></form>`;
  }

  function cardHtml(l) {
    return `<li class="lk" data-id="${esc(l.id)}"><div class="lk-body">`
      + `<a class="lk-main" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">`
      + `<span class="lk-title">${esc(l.title || host(l.url))}</span><span class="lk-url">${esc(host(l.url))}</span></a>`
      + (l.note ? `<span class="lk-note">${esc(l.note)}</span>` : '')
      + `</div><span class="lk-actions"><button type="button" data-act="copy">Copy</button>`
      + `<button type="button" data-act="edit">Edit</button>`
      + `<button type="button" data-act="del" title="Delete">×</button></span></li>`;
  }

  /** Redraw the whole tab. */
  function render() {
    const s = shelf();
    const q = filter.trim().toLowerCase();
    const shown = s.links.filter((l) => !q || `${l.title} ${l.url} ${l.note}`.toLowerCase().includes(q));
    const scopeName = state.libScope === 'general' ? 'General' : state.tree.title;
    let html = '<div class="lib-head"><h2>Library</h2>'
      + '<div class="seg" id="libScope">'
      + `<button type="button" data-v="project" class="${state.libScope === 'project' ? 'on' : ''}">This project</button>`
      + `<button type="button" data-v="general" class="${state.libScope === 'general' ? 'on' : ''}">General</button></div></div>`;
    html += `<p class="lib-sub">Links saved in <b>${esc(scopeName)}</b>. ${state.libScope === 'general' ? 'Shared by every project.' : 'Only this project.'}</p>`;
    html += '<div class="lib-tools"><input id="libSearch" type="search" placeholder="Search links" value="' + esc(filter) + '">'
      + '<button type="button" data-act="add">+ Add link</button></div>';
    if (editing === 'new') html += formHtml({ id: 'new', title: '', url: '', note: '' });
    html += '<ul class="lk-list">' + shown.map((l) => (editing === l.id ? `<li class="lk editing">${formHtml(l)}</li>` : cardHtml(l))).join('') + '</ul>';
    if (!shown.length && editing !== 'new') {
      html += s.links.length ? '<p class="none">No links match your search.</p>'
        : '<p class="none">No links yet. Click <b>+ Add link</b> to save one, like a form, a paper, or a shared folder.</p>';
    }
    $('libraryBody').innerHTML = html;
    if (editing) { const first = $('libraryBody').querySelector('.lk-form input[name="url"]'); if (first) first.focus(); }
  }

  async function copy(url) {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: url });
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Link copied'); } catch { toast("Couldn't copy the link"); }
      ta.remove();
    }
  }

  function submit(form) {
    const url = cleanUrl(form.url.value);
    if (!url) { toast('That doesn\'t look like a web address (use http, https or mailto).'); return; }
    const data = { title: form.title.value.trim(), url, note: form.note.value.trim() };
    const s = shelf();
    if (form.dataset.id === 'new') s.links.unshift({ id: newSmallId('l'), ...data });
    else { const l = s.links.find((x) => x.id === form.dataset.id); if (l) Object.assign(l, data); }
    editing = null;
    markDirty();
    updateSaveState();
    render();
  }

  function init() {
    const body = $('libraryBody');
    body.addEventListener('click', (e) => {
      const scope = e.target.closest('#libScope button');
      if (scope) { state.libScope = scope.dataset.v; editing = null; render(); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = (b.closest('.lk') || {}).dataset?.id;
      const link = id && shelf().links.find((x) => x.id === id);
      switch (b.dataset.act) {
        case 'add': editing = 'new'; render(); break;
        case 'cancel': editing = null; render(); break;
        case 'edit': editing = id; render(); break;
        case 'copy': if (link) copy(link.url); break;
        case 'del':
          if (link && confirm(`Delete the link "${link.title || host(link.url)}"?`)) {
            shelf().links = shelf().links.filter((x) => x.id !== id);
            markDirty();
            updateSaveState();
            render();
          }
          break;
      }
    });
    body.addEventListener('submit', (e) => { e.preventDefault(); if (e.target.classList.contains('lk-form')) submit(e.target); });
    body.addEventListener('input', (e) => {
      if (e.target.id !== 'libSearch') return;
      filter = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const s = $('libSearch');
      s.focus();
      s.setSelectionRange(pos, pos);
    });
    body.addEventListener('keydown', (e) => { if (e.key === 'Escape' && editing) { editing = null; render(); } });
  }

  return { init, render };
})();
