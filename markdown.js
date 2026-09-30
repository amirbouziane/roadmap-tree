/* Markdown + LaTeX -> sanitized HTML, Obsidian style.
 *
 *   $x^2$      inline math        $$ ... $$   display math (may span lines)
 *
 * Uses the vendored marked (Markdown), KaTeX (math) and DOMPurify
 * (sanitizer, since notes can come from any roadmap.json). Pure: text in,
 * HTML string out, so a VS Code webview can reuse it too.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Closing "$" must not touch a digit, so "costs $5 and $10" isn't read as math.
  const INLINE = /(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?!\d)/g;
  const DISPLAY = /\$\$([\s\S]+?)\$\$/g;
  const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g;

  function renderMarkdown(src) {
    src = String(src || '');
    if (!root.marked || !root.DOMPurify) return '<p>' + esc(src).replace(/\n/g, '<br>') + '</p>';

    const codes = [];
    const maths = [];

    // 1. Hide code so "$" inside it is left alone, 2. lift math out so
    // Markdown can't mangle underscores and asterisks inside formulas.
    let t = src.replace(CODE, (m) => { codes.push(m); return `zzcode${codes.length - 1}zz`; });
    t = t.replace(DISPLAY, (_, tex) => { maths.push({ tex: tex.trim(), display: true }); return `zzmath${maths.length - 1}zz`; });
    t = t.replace(INLINE, (_, tex) => { maths.push({ tex, display: false }); return `zzmath${maths.length - 1}zz`; });
    t = t.replace(/zzcode(\d+)zz/g, (_, i) => codes[i]);

    // 3. Markdown -> HTML, sanitized before any math HTML goes in.
    let html = root.DOMPurify.sanitize(root.marked.parse(t, { gfm: true, breaks: true }));

    // 4. Put the formulas back, typeset.
    return html.replace(/zzmath(\d+)zz/g, (_, i) => {
      const m = maths[i];
      if (!root.katex) return esc(m.tex);
      try {
        return root.katex.renderToString(m.tex, { displayMode: m.display, throwOnError: false, trust: false });
      } catch { return esc(m.tex); }
    });
  }

  root.renderMarkdown = renderMarkdown;
})(typeof window !== 'undefined' ? window : globalThis);
