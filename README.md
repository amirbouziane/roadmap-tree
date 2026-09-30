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

## Time tracking and calendar

- Hover a row and click **▶** to start a timer on it; click **■** (or **Stop**
  in the top bar) to stop. Starting another task stops the current one.
  Starting a planned task also marks it active.
- A running timer survives a refresh or closing the tab; it keeps counting
  from the original start time.
- The **Calendar** tab shows each day's tracked time, shaded by amount. Click
  a day to see time per task and the individual sessions. You can delete a
  session or add time by hand there.
- Each row shows its total time (branches include their children).
- Sessions are stored in `roadmap.json` under `"log"` (`node`, `label`,
  `start`, `end` as epoch milliseconds), so they're saved with the roadmap.
  Sessions crossing midnight are split between the two days.

## Windows app (.exe) and updates

**Install:** download `Roadmap Tree Setup x.y.z.exe` from the repo's
**Releases** page and run it. The installer is unsigned, so SmartScreen will
warn ("More info" → "Run anyway"). Data lives in
`%APPDATA%\roadmap-tree\roadmap.json`; **Save** writes there directly.

**Updates:** the installed app checks GitHub Releases at startup and every 4
hours, downloads new versions in the background, and asks whether to restart.
Your data isn't touched by updates.

**Publish a new version** (no Node needed on your PC, GitHub builds it):

```bash
git tag v0.2.1
git push origin v0.2.1
```

The *Release* workflow (`.github/workflows/release.yml`) builds the installer
and attaches it to a release. Tag versions must go up each time.

The repo must be **public** for installed apps to fetch updates without a
token.

**Build locally instead** (needs [Node.js](https://nodejs.org) LTS):

```bash
npm install
npm start        # try it as a desktop window
npm run dist     # builds dist/Roadmap Tree Setup 0.2.0.exe
```

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
