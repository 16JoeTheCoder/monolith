# Monolith

A small Windows overlay that makes you work on **one task at a time** and actually finish it.

If you start five things and finish none, Monolith is the friction you need. It sits in the
top-left corner of your screen as a translucent card showing one task and one timer.
Switching tasks is deliberately awkward, finishing takes a short ritual, and before you start
you have to write down what "finished" means. It also keeps an honest record of where your
focus went, so you can see when you are drifting.

---

## Install (for friends)

1. Open the repository's **Releases** page on GitHub and download the latest
   `Monolith-Setup-<version>.exe`. If you would rather not install anything, download
   `Monolith-Portable-<version>.exe` instead and just run it.
2. Windows will probably show **"Windows protected your PC"**. That is because the app is not
   code-signed (signing certificates cost money). Click **More info**, then **Run anyway**.
3. In the installer you can choose the install folder. Monolith starts as a small card in the
   top-left corner of your screen. Click it to open the panel.

**Where your data lives:** `%APPDATA%\Monolith\`, usually
`C:\Users\<you>\AppData\Roaming\Monolith\`. Nothing leaves your PC. There is no account, no
sync and no telemetry.

**Uninstall:** Windows Settings → Apps → Installed apps → Monolith → Uninstall. The uninstaller
leaves your data behind on purpose; delete `%APPDATA%\Monolith\` too if you want it gone. For
the portable version, delete the exe and that folder.

### FAQ

- **Where did the card go?** It may be behind the taskbar or on another monitor. Use the tray
  icon (bottom-right, maybe under the ^ arrow) → *Open panel*, or press `Ctrl+Alt+Space`.
- **How do I quit?** Tray icon → *Quit Monolith*, or Settings → About → *Quit Monolith*.
  Closing the panel only collapses it.
- **Can I switch to another task?** No, that is the point. Finish it, or drop it with a reason.
  Dropped tasks go to the back of the queue.
- **I put my laptop to sleep and it asked me about a time gap.** Monolith never silently counts
  time it could not see. Choose whether the gap counted.
- **Something broke.** Click *Restart Monolith* if you see an error card. Send the
  log at `%APPDATA%\Monolith\logs\monolith.log` to whoever gave you the app.
- **Start fresh?** Settings → About → *Reset all data*.

---

## The single-focus rules

1. **One active task.** Exactly one task is in focus; the rest wait in the queue, and finished
   tasks go to history. There is no "switch task" and no starting a task out of order.
2. **Define done first.** A task needs a *finish condition* (at least 8 characters) describing
   exactly what finished looks like. It is editable until the timer first starts, then locked.
3. **The finish ritual.** Monolith shows your finish condition and you type
   `I have finished this task` (case, extra spaces and a trailing period don't matter). Then
   you grade yourself: **Fully**, **Mostly** or **Barely**. Main re-checks the phrase. A short
   summary appears, then the next queued task becomes active with its timer idle.
4. **Escape hatch: Drop.** Pick why, and type a reason (at least 3 characters):
   - *Blocked by something outside my control*: no penalty.
   - *I lost focus or interest*: the task's time counts as **orphaned** until you finish it,
     and your **chain** resets.

   Either way the timer stops, tracked time is kept, and the task goes to the back of the
   queue. You can't drop when nothing else is queued; delete the task instead.
5. **Reopen.** A completed task goes back to the front of the queue (or becomes active if
   nothing is). Totals are kept.
6. **Delete.** Works for any task; tasks with tracked time ask for confirmation first. Deleting
   an unfinished task with work time adds that time to *orphaned*. Your daily record and
   journal keep everything already recorded.

---

## What the numbers mean

All of these live on the **Done** tab. None of them appear on the compact card.

| Number | Meaning |
| --- | --- |
| **Banked** | Total tracked work of every task you finished. |
| **Orphaned** | Work on tasks you dropped for lost focus (until finished), plus deleted unfinished work. |
| **Chain** | Finishes in a row with at least 10 tracked minutes and no lost-focus drop in between. A shorter finish neither counts nor breaks it. Current and best. |
| **This week** | "Finished 3 of 4 started this week - 2 fully". Weeks start Monday 00:00 local time. |
| **Focus per day, lifetime** | All focus time divided by every calendar day since your first focused day (weekends and zero days included), with the last-7-days average beside it. |
| **Start latency** | Average time between a task becoming active and your first Start press, for tasks first started this week. |
| **Estimates** | After 3 finished tasks with estimates: the median of actual / estimate, e.g. "Your estimates run 40% short - multiply by 1.4", or "accurate" within 10%. The add/edit form then shows "about Z min at your usual pace". |
| **Heatmap** | Focus per day for the last 20 weeks, 4 shades relative to your best day. Hover for the value. |

### Focus Index (0-100)

Hidden until you have 3 finished tasks and 3 days with focus ("Calibrating: 1/3 tasks, 2/3
days"). It combines five parts:

| Part | Weight | Measures |
| --- | --- | --- |
| Completion | 35% | (Fully + ½ × Mostly) / started. Ungraded finishes count as Mostly. |
| Depth | 25% | Share of focus time in stretches of 15 minutes or more. |
| Estimates | 15% | Median of min(actual, estimate) / max(actual, estimate); 0.5 if none. |
| Consistency | 15% | Days with focus in the last 14, divided by 14. |
| Few pauses | 10% | 1 − (pauses per focus hour / 6), clamped. |

Each part is pulled toward 0.5 by a weight of 5 / (n + 5), where n is the number of finished
tasks, so three lucky tasks can't give you 100. Confidence is *low* under 10 tasks, *medium*
from 10 to 29 and *high* from 30. One sentence names your weakest part with its real number,
for example "Your median stretch is 11 min."

---

## Run, test, build

Requires Node 20+ and npm.

```bash
npm install          # also downloads the Electron binary
npm run dev          # Vite dev server + Electron (hot reload for the UI)
npm test             # vitest: timer engine, rules, record, metrics, migration, store, recovery
npm run typecheck    # tsc --noEmit over src and tests
npm run build        # dist/main.js, dist/preload.js, dist/renderer/
npm run package:win      # installer + portable exe in release/  (run on Windows)
npm run package:win:dir  # unpacked build in release/win-unpacked/ for quick checks
npm run icon         # regenerate build/icon.png
```

### How to release

```bash
# bump "version" in package.json (npm version 0.2.0 --no-git-tag-version), update CHANGELOG.md, commit, then:
git tag v0.2.0 && git push --tags
```

`.github/workflows/build-windows.yml` runs on `windows-latest` for every push and pull request:
`npm ci`, tests, typecheck, build, then electron-builder. Every run uploads the exes as the
**Monolith-windows** artifact. On a `v*` tag it also creates a GitHub Release named
`Monolith v0.2.0` with `Monolith-Setup-0.2.0.exe` and `Monolith-Portable-0.2.0.exe` attached
(the workflow has `permissions: contents: write`).

**Releases on a private repository are only visible to people with access to it.** To share
with friends, either make the repository public or add them as collaborators.

---

## Architecture

Electron + React + TypeScript. esbuild bundles main and preload to CommonJS; Vite builds the
renderer (`base: './'` so it loads from `file://`). Runtime code is only Electron and React: no
UI framework, no state or chart library, inline SVG icons, CSS grid.

```
src/
  shared/      pure logic, no Electron imports (used by main, renderer and tests)
    types.ts       data model v2, commands, snapshot
    timer.ts       timestamp-based timer engine
    tasks.ts       single-focus rules, saveDraft, journal and chain on finish/drop
    record.ts      daily record: books closed work slices, Today figure
    insights.ts    Done-tab metrics: banked, orphaned, Focus Index, calibration, heatmap
    migrate.ts     v1 -> v2 migration and sanitising of stored data
    validation.ts  field/timer/settings/accelerator validation, finish phrase, grades
    format.ts      clock/duration/date formatting, day keys, week and day starts
    api.ts         the preload API interface and IPC channel names
  main/
    main.ts        entry: wires controller, window, tray, shortcuts, power events, notifications, log
    controller.ts  state machine: commands, persistence, crash/sleep/clock-jump handling
    store.ts       atomic JSON store, heartbeat, one-time v1 backup
    window.ts      overlay window: fit-to-card sizing, expand/collapse, focus handoff, dragging
    log.ts         userData/logs/monolith.log, rotated at 1 MB with one backup
    tray.ts, shortcuts.ts, ipc.ts
  preload/preload.ts  exposes window.monolith (contextIsolation + sandbox)
  renderer/        React UI (App with error boundary, Compact, Panel, four tabs, styles.css)
tests/           vitest suites
scripts/         build.mjs, dev.mjs, make-icon.mjs (dependency-free PNG writer)
```

**shared/** is the core. Everything that decides behaviour is a pure function with an
explicit `now`, so the same code runs in main (the authority), in the renderer (to display
time and stats) and in tests with a fixed clock.

**tasks.ts** implements the rules as immutable transformations of `AppData`, each ending in
`normalize()`: the first non-completed task is the only active one (its `activatedAt` is set
when it becomes active), nothing queued keeps running, and settings stay in range.

**record.ts** keeps the daily record. Work enters it in exactly one place, `recordWork(prev,
next)`, which the controller calls on every state change: it books each newly closed work
session, split at local hour and midnight boundaries, into `days`. Pauses, starts, finishes
and drops are counted where they happen. Because the record sits beside the tasks rather than
inside them, deleting a task never rewrites history.

**insights.ts** reads the record, the journal and the tasks to produce the Done tab. Nothing
there is stored; it is recomputed every second from data that is.

**controller.ts** owns the live state, persists after every change, and handles every case
where time passed unobserved. It has no Electron imports, so tests drive it against a temp
directory.

**window.ts** manages the one frameless, transparent, always-on-top window. The compact card
is sized by its content (240-520 × 80-260 px); the renderer measures it with a
ResizeObserver and main resizes the window to match, keeping the top-left corner fixed, so
there is never a transparent margin blocking clicks.

**renderer/** receives a snapshot only when something changes and works out displayed time
itself from `Date.now()`, so there is no per-second IPC.

---

## How the timer engine works (and why)

Time is **never counted with an interval**. A runtime stores `phaseElapsedMs` (time already
banked in the current phase) and `sliceStartedAt` (when the current running stretch began, or
`null`). Elapsed is `phaseElapsedMs + (now - sliceStartedAt)`, so a throttled renderer, a late
tick or a busy CPU can't make the clock drift.

Closing a slice adds its length to `workMs` or (for Pomodoro breaks) `breakMs` and appends a
session (newest 300 kept). `advance(task, now)` handles every boundary crossed up to `now`.
A countdown either stops at zero (never negative) or continues into overtime and notifies
once. A Pomodoro phase is closed at its **exact end timestamp**, not at `now`, so a late tick
can't move break time into work. Auto-start begins the next phase from that same timestamp,
looping with a guard through several phases after a long sleep. `reset` clears only the
display; `skipPhase` gives no pomodoro credit for skipped work. A clock moving backwards never
produces negative time.

---

## Sleep, shutdown and crash recovery

When Monolith finds that time passed while it wasn't watching, it stops the timer at the
**last moment it knows it was alive** and asks whether that stretch should count.

- **Heartbeat:** while a timer runs, main writes the time to `heartbeat` every 5 s.
- **Startup:** if the active task was running and `now - max(heartbeat, sliceStartedAt) > 15 s`,
  the slice is closed there, the timer pauses and a gap is raised.
- **While running:** a 250 ms tick. More than 10 s between ticks (sleep, forward jump) pauses at
  the last tick and raises a gap; a backwards clock closes the slice at the last tick and
  restarts it.
- **Power events:** `suspend` pauses at that moment, `resume` raises a gap, `shutdown` writes a
  final heartbeat.
- **The prompt:** *"Your PC was off/asleep from HH:MM to HH:MM (X). Count that time, or go back
  to the last recorded time?"* Counting replays the gap (Pomodoro boundaries included, their
  notifications suppressed) and those slices enter the daily record like any other. Either
  way the timer stays paused until you press Resume.

---

## Where your data lives

`%APPDATA%\Monolith\`:

| File | Purpose |
| --- | --- |
| `monolith-data.json` | tasks, settings, window position, events, daily record, journal (format v2) |
| `monolith-data.json.bak` | previous version; used automatically if the main file is corrupt |
| `state.v1.bak.json` | your 0.1 data exactly as it was before the one-time migration to v2 |
| `heartbeat` | last time a running timer was seen alive |
| `logs\monolith.log` (+ `.1`) | uncaught errors; rotated at 1 MB |

Every save writes `.tmp`, fsyncs it, copies the current file to `.bak` and renames `.tmp` over
the real file. To reset: Settings → About → *Reset all data*, or quit and delete the folder.

### Migrating from 0.1

On the first launch of 0.2, a v1 file is copied to `state.v1.bak.json`, then migrated:
`value`, `valueIsEarned`, `notes`, `deadline`, `currency` and `showMoneyInCompact` are dropped.
Tasks, sessions, totals, events, settings and the window position are kept. The daily record
is rebuilt from stored sessions and events, and the journal from completed tasks (grade
unknown, counted as Mostly in the Focus Index). Each task gets `activatedAt = createdAt` and
`lostFocusDrops = 0`. Card opacity keeps its old value.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+Space` (configurable) | open / collapse the panel (global) |
| `Ctrl+Alt+P` (configurable) | start / pause the active task (global; ignored during a gap prompt) |
| `Esc` | close the panel (asks Save / Discard / Keep editing if there are unsaved edits) |
| `←` / `→` on the tab bar | switch tabs |
| `Enter` in the finish ritual | continue to the grade once the phrase matches |

---

## Settings reference

| Setting | Default | Notes |
| --- | --- | --- |
| Theme | Graphite | Graphite, Midnight, Ember, Forest; applies to the card and the panel |
| Accent | theme's | optional custom colour; "Use theme colour" clears it |
| Card opacity | 65% | 0-100%. Only the background fades; text keeps a shadow for readability |
| Status row / Task title / Timer digits / Progress bar | 11 / 17 / 34 / 3 px | 9-16, 12-28, 24-64, 2-12. The window grows to fit. *Reset appearance* restores defaults |
| Default timer | Countdown 25 min, stop at zero | Pomodoro 25/5/15, long break every 4, no auto-start |
| Sound / Notifications | on / on | at timer boundaries |
| Launch at startup | off | installed app only; also in the tray menu |
| Global shortcuts | on | two validated accelerator fields |

Appearance is previewed live on a real compact card in Settings. Like all settings, it is
applied by **Save Changes & Collapse**.

Task fields: name (1-120 characters), finish condition (at least 8), priority (shown as a
small dot on the card and queue rows) and an optional estimate in minutes.

---

## Decisions made

- **Orphaned lasts until finish.** A lost-focus task's time stays orphaned even once it is
  active again; only finishing it clears it.
- **Short finishes don't break the chain.** A finish under 10 tracked minutes neither extends
  nor resets it, so finishing small tasks is never punished; only a lost-focus drop resets it.
- **"Tracked" means work time.** Journal `trackedMs`, banked, calibration and the chain use work
  time; Pomodoro breaks are excluded.
- **A pause** is counted only when you press Pause (or the shortcut) on a running slice, not
  when a countdown stops by itself or the app pauses for sleep.
- **Start latency** is stored on the task at its first Start (`startLatencyMs`), measured from
  `activatedAt`; for migrated tasks, from `createdAt`.
- **Migrated users see the welcome card once**, as it introduces the new finish grade and drop
  options.
- **The heatmap always shows 20 weeks**, so it reads as a calendar from day one.
- **Saving settings never overwrites immediate flags** (welcome dismissed, tray startup toggle).
- **Version numbering:** 0.1 shipped with `1.0.0` in package.json; 0.2 is `0.2.0` to match the
  release name.
- From 0.1: main is the authority and re-validates every IPC payload; the controller has no
  Electron imports; dragging polls the cursor and calls `setBounds` with a fixed size to avoid
  DPI drift; CSP is strict in production builds; the heartbeat is written only while a timer
  runs.

---

## Verification

**VERIFIED in the Linux sandbox**

- `npm test`: 39 tests pass, covering the timer engine, queue rules, validation, persistence,
  `.bak` fallback, crash/sleep recovery and clock moving backwards, plus 0.2:
  - v1 → v2 migration (fields dropped, history kept, record and journal backfilled, backup
    written once);
  - the daily record across hour and midnight boundaries, booked once and surviving deletion;
  - banked, orphaned and chain rules (blocked vs lost-focus drop, the 10-minute rule, a later
    finish un-orphaning);
  - the Focus Index (gate, 0-100 bounds, shrinkage, confidence);
  - calibration, start latency, the lifetime average with zero days, opacity 0 and 100%,
    font clamping, and Today including the live slice.
- `npm run typecheck` is clean and `npm run build` succeeds.
- A headless smoke launch (Electron under Xvfb, driven by Playwright from outside the repo):
  1. A v1 data file migrated and `state.v1.bak.json` was written.
  2. The welcome card appeared and dismissed.
  3. Finish → grade → summary worked, and the Queue and Done tabs rendered.
  4. Settings changes (0% opacity, 28/64 px fonts, Ember theme) saved, and the compact window
     resized to fit the card.
  5. No console errors.

**NOT VERIFIED, needs checking on real Windows**

- Always-on-top, transparency, rounded corners and no click-blocking margin.
- The compact window auto-fit at large fonts and at 125% / 150% display scaling.
- Readability at 0% opacity over light and dark backgrounds.
- Dragging, focus handoff on collapse, the sleep/resume prompt.
- Launch at startup, global shortcuts, notifications and sound.
- The error boundary's Restart (relaunch) and the log file location.
- The installer, portable exe, uninstaller and the SmartScreen warning.

### Manual Windows test checklist

1. Install 0.2 over an existing 0.1 install with some history. Check
   `%APPDATA%\Monolith\state.v1.bak.json` exists and that tasks, totals and the Done numbers
   look right.
2. On first expand the welcome card shows; *Got it* hides it for good.
3. Settings → Appearance: set title 28 px and digits 64 px, then save. The card grows and the
   window fits it exactly: click just outside its edges and the click must reach the app
   underneath. Repeat at 150% display scaling.
4. Set opacity to 0%, save, and check the text is readable over a white page and a dark
   wallpaper.
5. Finish a task: phrase → grade → 5 s summary → next task. Drop one as *lost focus* and check
   Orphaned and Chain on the Done tab.
6. Sleep the PC with a timer running, wake it, and answer the gap prompt.
7. Uninstall and confirm `%APPDATA%\Monolith\` is left behind.

---

## Exact commands on Windows

```powershell
git clone https://github.com/16JoeTheCoder/monolith.git
cd monolith
git checkout v0.2
npm ci
npm test
npm run dev               # try it without installing
npm run package:win       # release\Monolith-Setup-0.2.0.exe and release\Monolith-Portable-0.2.0.exe
```
