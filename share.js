/* Share & feedback dialog.
 *
 * Share: the download link, a ready-made message to copy, and an email-a-friend
 * button. Feedback: pick a type, write a message, then send it as a pre-filled
 * GitHub issue (the person reviews and submits it in their browser) or copy it.
 *
 * Nothing is ever sent automatically, and no project data is included. The
 * optional "app version and system" line is the only extra, and it is shown
 * before sending and can be switched off.
 *
 * CONTACT below can hold a feedback-form link and/or an email address for people
 * without a GitHub account. They are empty on purpose: add them only if you are
 * happy for them to be public, since this file ships with the app.
 *
 * Relies on app.js globals (loaded after this file, used only when called):
 * $, esc, toast, appVersion, IS_DESKTOP.
 */
const Share = (() => {
  const REPO = 'https://github.com/amirbouziane/roadmap-tree';
  const DOWNLOAD = `${REPO}/releases/latest`;
  const CONTACT = { form: '', email: '' }; // e.g. form: 'https://forms.gle/…', email: 'you@example.com'

  const TYPES = {
    idea: { label: 'Idea', hint: 'What would make Roadmap Tree better for you?' },
    bug: { label: 'Bug', hint: 'What went wrong? What did you click, and what did you expect to happen?' },
    question: { label: 'Question', hint: 'What would you like to know?' },
    praise: { label: 'Praise', hint: 'What do you like? It helps to know what to keep.' },
  };

  let type = 'idea';

  const shareMessage = () => 'I have been using Roadmap Tree, a free planner that works offline: a progress tree, notes with math, '
    + 'a calendar with deadlines, a whiteboard, and a little pet that grows as you finish things. '
    + `Download it for Windows here: ${DOWNLOAD}`;

  /** "Windows desktop app v0.4.0" style summary; no personal data. */
  function systemLine() {
    const ua = navigator.userAgent;
    const os = /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'unknown OS';
    return `Roadmap Tree ${appVersion ? 'v' + appVersion : '(web build)'} · ${IS_DESKTOP ? 'desktop app' : 'browser'} · ${os}`;
  }

  function feedbackText(withSystem) {
    const msg = $('shFeedback').value.trim();
    return `${msg}${withSystem ? `\n\n---\n${systemLine()}` : ''}`;
  }

  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done); }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(done); } catch { toast("Couldn't copy. Select the text and copy it by hand."); }
      ta.remove();
    }
  }

  /** Open a link in the user's browser (the desktop app routes this to the default browser). */
  function openLink(url) {
    const a = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener noreferrer' });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const githubUrl = (withSystem) => {
    const msg = $('shFeedback').value.trim().slice(0, 3000);
    const first = msg.split('\n')[0].slice(0, 70);
    const title = `[${TYPES[type].label}] ${first}`;
    const body = `${msg}${withSystem ? `\n\n---\n${systemLine()}` : ''}`;
    return `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  };

  function render() {
    const typeButtons = Object.entries(TYPES).map(([k, t]) => `<button type="button" data-type="${k}" class="${k === type ? 'on' : ''}">${t.label}</button>`).join('');
    $('shareBody').innerHTML = `
      <section class="sh-sec">
        <h3>Share Roadmap Tree</h3>
        <p class="sh-note">It is free to share. Your projects and settings stay on your own computer.</p>
        <div class="sh-link"><input id="shLink" readonly value="${esc(DOWNLOAD)}" aria-label="Download link"><button type="button" data-act="copy-link">Copy link</button></div>
        <div class="sh-actions">
          <button type="button" data-act="copy-msg">Copy a ready-made message</button>
          <button type="button" data-act="mail-friend">Email it to a friend</button>
          <button type="button" data-act="open-download">Open download page</button>
          <button type="button" data-act="star">Star it on GitHub</button>
        </div>
      </section>
      <section class="sh-sec">
        <h3>Send feedback</h3>
        <div class="seg" id="shTypes">${typeButtons}</div>
        <textarea id="shFeedback" rows="5" maxlength="3000" placeholder="${esc(TYPES[type].hint)}"></textarea>
        <label class="sh-check"><input type="checkbox" id="shSystem" checked> Include the app version and system <small id="shSystemLine">${esc(systemLine())}</small></label>
        <div class="sh-actions">
          <button type="button" class="primary" data-act="send-github">Send on GitHub</button>
          <button type="button" data-act="copy-feedback">Copy feedback</button>
          ${CONTACT.email ? '<button type="button" data-act="send-email">Send by email</button>' : ''}
          ${CONTACT.form ? '<button type="button" data-act="send-form">Open feedback form</button>' : ''}
        </div>
        <p class="sh-note">Send on GitHub opens a ready-to-edit message in your browser; nothing is sent until you press submit there (a free GitHub account is needed).
        No project data is ever included. Prefer not to use GitHub? Copy your feedback and send it any way you like.</p>
      </section>`;
  }

  function open() {
    render();
    $('shareModal').hidden = false;
    $('shFeedback').focus();
  }

  function close() { $('shareModal').hidden = true; }

  function init() {
    $('shareClose').onclick = close;
    $('shareModal').addEventListener('click', (e) => { if (e.target === $('shareModal')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('shareModal').hidden) close(); });
    $('shareBtn').onclick = open;
    const settingsBtn = $('setShare');
    if (settingsBtn) settingsBtn.onclick = open;

    $('shareBody').addEventListener('click', (e) => {
      const t = e.target.closest('#shTypes button[data-type]');
      if (t) {
        type = t.dataset.type;
        const text = $('shFeedback').value; // keep what was typed while switching type
        const sys = $('shSystem').checked;
        render();
        $('shFeedback').value = text;
        $('shSystem').checked = sys;
        $('shFeedback').focus();
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const withSystem = !!($('shSystem') && $('shSystem').checked);
      const needText = () => { if ($('shFeedback').value.trim().length < 3) { toast('Write a few words of feedback first.'); $('shFeedback').focus(); return false; } return true; };
      switch (b.dataset.act) {
        case 'copy-link': copy(DOWNLOAD, 'Download link copied'); break;
        case 'copy-msg': copy(shareMessage(), 'Message copied. Paste it anywhere.'); break;
        case 'mail-friend': openLink(`mailto:?subject=${encodeURIComponent('Try Roadmap Tree')}&body=${encodeURIComponent(shareMessage())}`); break;
        case 'open-download': openLink(DOWNLOAD); break;
        case 'star': openLink(REPO); break;
        case 'copy-feedback': if (needText()) copy(feedbackText(withSystem), 'Feedback copied'); break;
        case 'send-github': if (needText()) openLink(githubUrl(withSystem)); break;
        case 'send-email':
          if (needText()) openLink(`mailto:${CONTACT.email}?subject=${encodeURIComponent(`Roadmap Tree feedback: ${TYPES[type].label}`)}&body=${encodeURIComponent(feedbackText(withSystem))}`);
          break;
        case 'send-form': openLink(CONTACT.form); break;
      }
    });
  }

  return { init, open, close, githubUrl, shareMessage, systemLine };
})();
