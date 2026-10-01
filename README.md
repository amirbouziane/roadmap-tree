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
| Open notes | Click a step's label |
| Collapse / expand | Click a branch's chevron |
| Move a step | Drag it (anywhere on the row, or the ≡ handle), or use ↑ / ↓ |
| Rename | Double-click a label; Enter saves, Esc cancels |
| Add a child | Hover a row, click **+** |
| Delete | Hover a row, click **×** |
| Everything open / shut | **Expand all** / **Collapse all** |
| Jump to an item | Click it in **What's next** |
| Save | **Save** or Ctrl+S |

## Projects, saving and opening elsewhere

- **Project tabs** sit above the toolbar. Click a tab to switch, double-click
  to rename, **+** for a new project, **×** to delete one (it asks first).
  Each project has its own steps, notes, calendar and time log.
- **Save** keeps everything (all projects) in the app's own data file; use it
  often. The **Save •** dot means there are unsaved changes.
- **Save as…** writes the open project to a `.json` file you choose, for
  backup, sharing, or moving to another PC. It doesn't change the app's data.
- **Import…** adds a project from such a file as a new tab. It also accepts
  an older single `roadmap.json`, and files holding several projects.

## Timer, targets and the calendar

- Hover a step and click **▶** to start its timer; click **■** to stop. Several
  steps can be timed at the same time; starting one never stops another. Hover
  the button to see the live running time (or the time tracked so far). The
  window title shows the longest-running clock, and a green dot marks each
  project tab that has a timer running.
- **Deadline colours:** a target date within 5 days (`SOON_DAYS` in `app.js`)
  turns **orange**, an overdue one turns **red**; finished steps are never
  flagged. The colour appears on the step (with a coloured edge), at the top
  of the project's sidebar under **Deadlines**, and as a dot on the project
  tab.
- **All projects:** under the calendar, the Calendar tab ranks every project
  by how much attention it needs (worst deadline first) and lists all
  unfinished deadlines from all projects, grouped as overdue, due soon, and
  later. Click a card to open that project, or a deadline to jump to the step.
- A **target date** is the day you want a step finished. Set it from the
  notes pane (**Target** date box), or open the **Calendar**, click a day, and
  use **Set target** there. Targets show as `target Oct 5` on the step (red if
  overdue and not done), as ⚑ on the calendar day, and in **What's next**.

## Graph, whiteboard, planner and library

- **Graph:** the open project as dots joined to their parents, like Obsidian.
  Drag a dot and the web follows; scroll to zoom; drag the background to pan;
  click a dot to jump to that step. Green = done or in progress, hollow =
  planned, red or orange ring = overdue or due soon. A note that mentions
  another step as `[[its name]]` adds a dashed line between them. The physics
  stops once the web settles.
- **Board:** a corkboard with sticky notes. Double-click the board (or
  **+ Note**) to add one, drag it by its top edge, resize from the corner,
  recolour with the dots, delete with ×. There is one board per project and a
  **General** board shared by all projects.
- **Calendar planner** (under the month grid): book a step into a **Morning,
  Afternoon or Evening**, for one day or repeated across a range of days.
  Drag a block to another slot or day. When a slot passes with its step
  unfinished, the block is listed as missed with a suggested next free slot
  (one click to accept), or you can mark it done or skip it. Today's plan also
  shows in the sidebar.
- **Library:** saved links (title, address, optional note), per project or in
  a general shelf. Only http, https and mailto links are accepted. Passwords
  are deliberately not stored, because project files are plain text.
- The general shelf and general board live in the workspace file (written when
  they have content); **Save as…** exports a single project without them.

## Settings

The **Settings** tab holds the theme (system, light or dark), how many days
before a target a step turns orange, whether project tabs sort themselves by
urgency or stay where you drag them, and your companion. They are stored on
this computer only.

## Companion: aquarium or jungle

Pick **one** in Settings: Aquarium, Jungle, or Off. Each habitat keeps its own
pets and food; pearls are one shared pool, so switching never loses anything.

**Auto-hiding frame:** after 3 seconds with the mouse away, the title bar,
buttons and border fade out and only the scene stays, so it looks part of the
app. Hover over it and they come back at once. The frame stays while the shop
is open, while you drag, and while a button has keyboard focus. Turn it off
with **Frame → Always show** in Settings.

**Jungle:** animals (tree frog, parrot, monkey, toucan, sloth, jaguar) that
hop, walk or fly around a jungle scene. Fruit falls to the ground and they eat
it and grow, just like the fish.

**Aquarium enclosures and decorations:** in the shop you can switch between
the **Classic** scene and a **Glass cube**, a realistic square tank with a lid
light and an air pump feeding an air stone. Decorations (tall plant, coral,
air stone, driftwood, castle, treasure chest, diver statue) are bought with
pearls and can be hidden or shown again.

### The aquarium basics

Click **Aquarium** at the top to open a small pixel fish tank. Drag it by its
title bar anywhere in the window; it remembers where you left it. It costs
almost nothing: a tiny canvas redrawn about 10 times a second, and the
animation stops entirely while the tank is closed, minimized or the window
is hidden.

- **Quests earn pearls:** finishing a step pays 1 pearl (once per step, even
  if you toggle it again), and every 30 minutes of tracked time pays 1 more.
  Time and steps already done before you first open the aquarium don't count.
- **Shop:** spend pearls on fish, from Common (2) to Legendary (40). The tank
  holds at most 7; release a fish to make room (no refund).
- **Feeding:** the **Food** bar shows up to 3 stored feeds; one fills back every
  30 minutes. Move the mouse over the scene and the pets swim over to you, as
  if expecting food. **Click** where you want the food to land and a few
  pellets drop right there (one feed each). Eating makes pets grow: baby,
  juvenile, adult.
- **Names:** every pet can have a name. A new pet opens a name box straight
  away (you can skip it), and **Rename** in the shop changes it any time
  (Enter saves, Esc cancels; empty goes back to the species name). Hover a pet
  to see its name.
- Fish never die. If they go a day without eating they look sleepy and slow.
- The tank is saved separately from your projects, so it survives updates but
  is not part of "Save as…" files.

## Share the app and leave feedback

Click **Share & feedback** at the top (or in Settings → About).

- **Share:** copy the download link (the project's Releases page), copy a
  ready-made message to paste anywhere, open a pre-written email to a friend,
  or star the project on GitHub.
- **Feedback:** choose Idea, Bug, Question or Praise, write your message, and
  press **Send on GitHub**. That opens a pre-filled issue in your browser; you
  read it and submit it there (a free GitHub account is needed). Or press
  **Copy feedback** and send it however you like. Nothing is sent
  automatically, and no project data is ever included. An optional line with
  the app version and your operating system can be switched off.
- For people without a GitHub account, set `CONTACT.form` (a link to a feedback
  form) and/or `CONTACT.email` at the top of `share.js`. They are empty by
  default because that file is public.

## What's new

After an update, the app shows what changed once. Reopen it any time from
the **What's new** link at the top. The text comes from `changelog.json`;
add an entry (`version`, `title`, `items` with a `tag` of `new`, `improved`
or `fixed`) before tagging each release.

## Notes (Markdown and LaTeX)

Click a step's label to open its notes in the pane next to the tree. A step
with no notes opens straight into edit mode; press **Done** (or Esc) to see
the rendered result, **Edit** to change it again. Steps that have notes show
a small ¶ after their label. Notes save with the roadmap, in each step's
`"md"` field.

- Markdown: headings, lists, task lists (`- [ ]`), tables, code, quotes, links.
- Math works like Obsidian: `$f_s \ge 2B$` inline, and `$$ ... $$` for a
  block (may span lines). A `$` followed by a digit, like `$5`, is left as text.
- Rendering uses bundled copies of marked, KaTeX and DOMPurify (`vendor/`), so
  it works offline. Notes are sanitized, so scripts in a note never run.

Collapse or expand a branch with its chevron (the label opens notes now).
Drag any step, by its row or the ≡ handle, to move it; ↑/↓ also work.

## Time tracking and calendar

- Hover a row and click **▶** to start a timer on it; click **■** to stop.
  Starting another task stops the current one.
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
