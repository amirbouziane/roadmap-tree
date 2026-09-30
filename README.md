# roadmap-tree

A local, interactive progress tree for a project. Plain HTML/CSS/JS: no
build step, no framework, no backend.

```
index.html    page shell
styles.css    look (light/dark follows the system)
app.js        model + pure renderer + app wiring
roadmap.json  your data, loaded at startup
```

## Run it

The page loads `roadmap.json` with `fetch`, and browsers block that on
`file://`, so serve the folder with any static server:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000> in Chrome or Edge.

(If you open `index.html` directly anyway, click **Open…** and pick
`roadmap.json`. That works too.)

## Use it

| Action | How |
| --- | --- |
| Change status | Click a dot: planned → active → done → planned |
| Collapse / expand | Click a branch's label or its chevron |
| Rename | Double-click a label; Enter saves, Esc cancels |
| Add a child | Hover a row, click **+** |
| Delete | Hover a row, click **×** |
| Everything open / shut | **Expand all** / **Collapse all** |
| Jump to an item | Click it in **What's next** |
| Save | **Save** or Ctrl+S |

**Saving.** In Chrome/Edge, Save uses the File System Access API. The first
time, pick your project's `roadmap.json` in the dialog and allow the write.
After that, Save writes to the same file without asking, until you reload the
page. If you use **Open…** first, Save writes back to that file straight away.
Other browsers download a `roadmap.json` for you to move into place.

**Unsaved changes** are kept in `localStorage`, so a refresh loses nothing.
While a draft exists it takes priority over the file on disk, and the Save
button shows `Save •`. **Discard** drops the draft and reloads from disk.
Collapsed and expanded branches are remembered separately; they're view
state, not data.

## Data format

```json
{
  "title": "SDR course",
  "nodes": [
    { "id": "rx", "label": "Receiver side", "children": [
      { "id": "m01", "label": "01 IQ samples", "status": "done", "note": "Ch 7",
        "children": [ { "id": "s11", "label": "1.1 Passband signals", "status": "done" } ] },
      { "id": "m02", "label": "02 Sampling", "status": "active", "note": "measure.py" }
    ]}
  ]
}
```

- `status` is `planned`, `active` or `done`.
- If a node has an explicit `status`, that's what it shows. If a parent has
  none, its status comes from its children: all done means done, any active
  or partly done means active, and anything else is planned. To make a parent
  derive its status again after you've clicked its dot, delete its `status`
  from the JSON.
- Progress is the share of **leaf** nodes that are done.
- `note` is optional and shows in grey after the label.

## Reusing the renderer

`render(tree, { collapsed })` in `app.js` is a pure function that returns an
SVG string. It does no DOM access. Interactive parts carry
`data-action="cycle|toggle|label|add|delete"` inside a `.rt-node[data-id]`
group, so another host, such as a VS Code webview, can reuse `render()` and
the model helpers and attach its own event delegation. The CSS classes
(`rt-*`, `s-done|s-active|s-planned`) are styled in `styles.css`.
