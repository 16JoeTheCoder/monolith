# Monolith

A small Windows overlay that makes you work on **one task at a time** and actually finish it.

If you start five things and finish none, Monolith is the friction you need. It sits in the
top-left corner of your screen as a translucent card that shows one task and one timer.
Switching tasks is deliberately annoying. Finishing one takes a ritual. Before you start a
task you have to write down what "finished" means.

---

## The single-focus rules

1. **One active task.** Exactly one task is in focus. Everything else waits in the queue;
   finished tasks go to history. The main view shows only the active task. You cannot switch
   tasks or start one out of order.
2. **Define done first.** You can't create a task without a *finish condition*: one or more
   sentences describing exactly what finished looks like (at least 8 characters). You can
   edit it until you first start the timer. After that it's locked and shown read-only.
3. **The finish ritual.** To finish, Monolith shows your finish condition and you type
   `I have finished this task`. Case, extra spaces and a trailing period don't matter; anything
   else is rejected. The main process checks the phrase again. The next queued task then
   becomes active with its timer idle. It never auto-starts.
4. **Escape hatch: Drop.** Dropping requires a typed reason (at least 3 characters). The timer
   stops and the tracked time is kept. The task moves to the back of the queue, its drop
   count goes up, and a `dropped` event is logged. You can't drop when nothing else is
   queued; delete the task instead.
5. **Reopen.** Reopening a completed task puts it at the front of the queue, or makes it active
   if nothing is active. Its totals are kept.
6. **Delete.** Works for any task. If the task has tracked time, Monolith asks you to confirm
   in the app first. Deleting the active task promotes the next one.
7. **Stats, not gamification.** For the current week (from Monday 00:00 local time) you see
   counts of tasks started, finished and dropped, plus your focused time today and this week.
   "Started" means the first time a task's timer was started.

---

## Run, test, build

Requires Node 20+ and npm.

```bash
npm install          # also downloads the Electron binary
npm run dev          # Vite dev server + Electron (hot reload for the UI)
npm test             # vitest: timer engine, task rules, store, recovery
npm run typecheck    # tsc --noEmit over src and tests
npm run build        # dist/main.js, dist/preload.js, dist/renderer/
npm run package:win      # Windows installer + portable exe in release/  (run on Windows)
npm run package:win:dir  # unpacked build in release/win-unpacked/ for quick checks
npm run icon         # regenerate build/icon.png
```

`npm run dev` restarts the UI on save. After changing main-process code, stop it and run it
again.

### Getting the installer from GitHub Actions

`.github/workflows/build-windows.yml` runs on `windows-latest` for every push and pull
request. It runs `npm ci`, the tests, the typecheck and the build, then electron-builder.

1. Open the repository on GitHub, go to **Actions** and choose **Build Windows**.
2. Open the latest successful run and download the **Monolith-windows** artifact (a zip).
3. Inside you'll find `Monolith-Setup-<version>.exe` (installer: you choose the install
   folder) and `Monolith-Portable-<version>.exe` (no install needed).

If you push a tag such as `v1.0.0`, the same files are also attached to a GitHub Release.

The build is **unsigned**, so Windows SmartScreen will warn you ("Windows protected your PC").
Click **More info** and then **Run anyway**.

---

## Architecture

Electron + React + TypeScript. esbuild bundles the main process and preload to CommonJS, and
Vite builds the renderer (`base: './'` so it loads from `file://` when packaged). Runtime
dependencies are only Electron and React. There is no UI framework, no state library and no
icon package.

```
src/
  shared/      pure logic, no Electron imports (used by main, renderer and tests)
    types.ts       data model, commands, snapshot
    timer.ts       timestamp-based timer engine
    tasks.ts       single-focus rules, saveDraft, stats, money totals
    validation.ts  field/timer/settings/accelerator validation, finish phrase
    format.ts      clock/duration/money/date formatting, week and day starts
    api.ts         the preload API interface and IPC channel names
  main/
    main.ts        entry: wires controller, window, tray, shortcuts, power events, notifications
    controller.ts  state machine: commands, persistence, crash/sleep/clock-jump handling
    store.ts       atomic JSON store + heartbeat file
    window.ts      overlay window: sizing, expand/collapse, focus handoff, dragging
    tray.ts        tray icon (embedded 32 px PNG) and menu
    shortcuts.ts   global shortcut registration with error reporting
    ipc.ts         IPC handlers; rebuilds and validates every payload
  preload/preload.ts  exposes window.monolith (contextIsolation + sandbox)
  renderer/        React UI (App, Compact, Panel, Focus/Queue/Done/Settings tabs, styles.css)
tests/           vitest suites
scripts/         build.mjs, dev.mjs, make-icon.mjs (dependency-free PNG writer)
build/icon.png   512 px app icon
```

**shared/** is the core. Everything that decides behaviour is a pure function that takes an
explicit `now`, so the same code runs in main (the authority), in the renderer (to display
time), and in tests with a fixed clock.

**timer.ts** turns a task's runtime (status, phase, accumulated time, start of the current
running slice) into what to show and which boundaries were crossed. See the next section.

**tasks.ts** implements the rules above as immutable transformations of `AppData`. Each one
ends with `normalize()`, which enforces the invariant: the first non-completed task is the
only active task, and any other task that is somehow still running gets stopped.

**validation.ts** is shared on purpose. The renderer uses it for inline errors, and main runs
the same checks again on everything that arrives over IPC.

**controller.ts** owns the live state. It runs commands through `tasks.ts`, persists
immediately after every change, notifies main about timer events, and handles every case
where time passed unobserved. It has no Electron imports, so the tests drive it directly
against a temp directory.

**store.ts** writes `monolith-data.json` crash-safely and keeps the heartbeat file (see
below).

**window.ts** manages the one frameless, transparent, always-on-top window. That covers
sizing it exactly to the card, the expand/collapse order, focus handoff, and drag-by-polling.

**ipc.ts** checks that each message comes from our own window. It then rebuilds every payload
field by field from known keys before the controller validates the values again. The preload
exposes one typed API: a snapshot stream, one `command` channel, and a few window
operations.

**renderer/** gets a snapshot from main only when something changes. It works out the
displayed time itself every 250 ms from the snapshot and `Date.now()`, using the same
`display()` as main. So there is no IPC traffic once per second.

---

## How the timer engine works (and why)

Time is **never counted with an interval**. A runtime stores:

- `phaseElapsedMs`: time already banked in the current phase.
- `sliceStartedAt`: when the current running stretch (a *slice*) began, or `null`.

Elapsed time is `phaseElapsedMs + (now - sliceStartedAt)`. A throttled renderer, a late tick or
a busy CPU therefore can't make the clock drift.

**Closing a slice** banks its length into `phaseElapsedMs`. It also adds the length to either
`workMs` (work phases, stopwatch, countdown) or `breakMs` (Pomodoro breaks), and appends a
session record (only the newest 300 are kept). Break time can never be counted as work time.

**`advance(task, now)`** handles every boundary crossed up to `now`:

- **Countdown.** When the countdown reaches its duration, it either *stops*: status becomes
  `completed`, elapsed is clamped to the duration, and remaining time is never negative. Or it
  *continues* into overtime and the event fires only once (`expiredNotified`).
- **Pomodoro.** When a phase ends, the slice is closed at the phase's **exact end timestamp**,
  not at `now`. That way a tick that arrives 3 minutes late can't move 3 minutes of break into
  work. After a work phase, `pomodorosCompleted` and the cycle count go up, and the next phase
  is a long break if the cycle count has reached the configured number (the count then resets),
  otherwise a short break. If auto-start is on for the next phase, it starts running *from that
  same end timestamp*. This repeats with a guard, so a long sleep with auto-start correctly
  passes through several phases. Without auto-start, the next phase waits as `idle`.

`reset` clears only the current display and cycle; totals and sessions stay. `skipPhase`
(Pomodoro only) ends the current phase immediately. Skipping a work phase earns no pomodoro.
If the clock moves backwards, elapsed time is clamped at 0 and is never negative.

---

## Sleep, shutdown and crash recovery

The rule: when Monolith finds that time passed while it wasn't watching, it stops the timer at
the **last moment it knows it was alive** and asks you whether that stretch should count.

- **Heartbeat.** While a timer runs, main writes the current time to a tiny `heartbeat` file
  every 5 s.
- **Startup.** If the active task was running and `now - lastAlive > 15 s` (where
  `lastAlive = max(heartbeat, sliceStartedAt)`), the slice is closed at `lastAlive`, the timer
  is paused and a *gap* is raised. Smaller gaps, such as a quick restart, continue seamlessly.
- **While running.** Main ticks every 250 ms. If more than 10 s passed between ticks (sleep,
  suspension, the clock jumping forward), it pauses at the last tick and raises a gap. If the
  clock moved *backwards*, the slice is closed at the last tick and restarted at the new `now`.
  Nothing is lost and nothing goes negative.
- **Power events.** `suspend` pauses at that exact moment. `resume` raises a gap. `shutdown`
  writes a final heartbeat.
- **The prompt.** The panel opens automatically without taking focus and shows: *"Your PC was
  off/asleep from HH:MM to HH:MM (X). Count that time, or go back to the last recorded time?"*
  Timer controls and the start/pause shortcut are disabled until you answer.
  - **Count it:** the timer is replayed as if it had run from `from` to `to`, so Pomodoro
    boundaries inside the gap are handled correctly (their notifications are suppressed).
  - **Go back:** the timer stays paused at the last recorded time.
  - Either way, the timer **stays paused** until you press Resume.

---

## Where your data lives

`%APPDATA%\Monolith\` (Electron's `userData`), usually `C:\Users\<you>\AppData\Roaming\Monolith\`:

| File | Purpose |
| --- | --- |
| `monolith-data.json` | all tasks, settings, window position, events |
| `monolith-data.json.bak` | the previous version; used automatically if the main file is corrupt |
| `heartbeat` | last time a running timer was seen alive |

Every save writes a `.tmp` file, flushes it to disk (fsync), copies the current file to
`.bak`, then renames `.tmp` over the real file.

**To reset Monolith:** quit it from the tray, delete the folder above, and start it again.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+Space` (configurable) | open / collapse the panel (global) |
| `Ctrl+Alt+P` (configurable) | start / pause the active task (global; ignored while a gap prompt is open) |
| `Esc` | close the panel (asks Save / Discard / Keep editing if you have unsaved edits) |
| `←` / `→` on the tab bar | switch tabs |
| `Enter` in the finish ritual | complete the task once the phrase matches |

If a global shortcut can't be registered (usually because another app already uses it), the
Settings tab shows an error.

---

## Using the panel

- **Compact card.** Click it to expand, drag it to move. It has no buttons. The card shows the
  mode, the state (Running / Paused / Time's up / Ready), the Pomodoro phase and cycle (for
  example "Work 2/4"), the task name, large digits and a progress bar.
- **Focus tab.** The active task only: its finish condition, the timer, controls for the
  current mode, tracked time, **Finish task** and a small **Drop task** link. Queued tasks
  appear only as a count.
- **Queue tab.** Add tasks. Shows the pinned "In focus" row and the "Up next" rows with
  up/down reorder, edit and delete. You can't change the active task's timer while it's
  running.
- **Done tab.** Weekly stats, total value, earned income, an estimated rate per tracked hour,
  and history with Reopen and Delete.
- **Settings tab.** See the reference below.
- **Save Changes & Collapse.** Edits to existing tasks and settings stay in a local draft until
  you press this button. It validates the draft, sends it to main in one go, and main validates
  it again and applies it atomically. Everything else (add, delete, reorder, finish, drop,
  reopen, timer controls, the gap answer) takes effect immediately. Saving never touches a
  running timer.

---

## Settings reference

| Setting | Default | Notes |
| --- | --- | --- |
| Default timer mode | Countdown 25 min, stop at zero | Used for new tasks |
| Countdown | 1 s to 24 h | Stop at zero, or keep counting into overtime |
| Pomodoro | 25 / 5 / 15 min, long break every 4 | Work 1-180 min, breaks 1-60 min, long break every 1-12 sessions, auto-start breaks/work (off) |
| Idle opacity | 65% | 50-80%. Only the card background is translucent; text stays opaque |
| Currency | IDR | IDR, USD, EUR, SGD, JPY, KRW, CHF, GBP, MYR, AUD; at most 2 decimals |
| Sound | on | short synthesised beep at timer boundaries |
| Notifications | on | silent desktop notification at timer boundaries |
| Launch at startup | off | installed app only (`app.isPackaged`); also in the tray menu |
| Global shortcuts | on | two accelerator fields, validated |
| Show money in compact | off | shows the task's value on the card |

Task fields: name (1-120 characters), finish condition (at least 8), value (≥ 0, decimals
allowed, zero is fine), "value is earned income", notes (up to 2000), priority, deadline and
estimate.

---

## Decisions made

- **Drop reasons are stored** in the `dropped` event as an optional `reason` field. This is a
  small addition to the event shape, so you can look back at why you dropped something.
- **Dropping resets the display to idle** while keeping all tracked time. That keeps "the next
  task becomes active with its timer idle" true for every queued task.
- **Starting a countdown that already stopped** at zero begins a fresh round. Totals are kept.
- **Main is the authority.** Commands go through one `command` IPC channel with a
  discriminated union. Main rebuilds the payload from known keys and validates it with the
  same shared validators the UI uses.
- **The controller has no Electron imports**, so the recovery logic (heartbeat, gaps, clock
  jumps) is covered by tests against a real temp directory.
- **The tray and global shortcut ask the renderer to collapse** instead of collapsing
  directly. That way unsaved edits still get the Save / Discard / Keep editing prompt.
- **CSP only in production builds.** The Vite dev server needs inline scripts for Fast
  Refresh, so the strict `Content-Security-Policy` is injected only when building.
- **No `-webkit-app-region` dragging.** It swallows clicks and can't tell a click from a drag.
  Main polls the cursor instead (see `window.ts`).
- **React is a devDependency** because Vite bundles it into the renderer. The packaged app
  contains no `node_modules`.
- **The original GitHub profile README was moved** to `docs/PROFILE-README.md` so this README
  can describe Monolith.
- **The heartbeat is written only while a timer runs**, as the spec requires, so an idle app
  causes no disk writes.

---

## Verification

**VERIFIED in the Linux sandbox**

- `npm test`: 27 tests pass (timer engine, task rules, validation, money, store round trip,
  `.bak` fallback, restart with a running timer: gap discard and gap count, backwards clock,
  saveDraft leaves the runtime untouched).
- `npm run typecheck` is clean.
- `npm run build` succeeds.
- Headless smoke launch (Electron under Xvfb, driven by Playwright from outside the repo):
  1. The compact card appears at (16, 16), 300 DIP wide, with the window height matching the
     card.
  2. Clicking expands it to 420 × 700.
  3. Quick-add, Start, the finish ritual, the Done stats and Save & Collapse all work.
  4. No console errors.
- `electron-builder --win --dir` on Linux produced `app.asar` and the unpacked layout. It then
  stopped at the step that edits the exe resources, because that step needs wine, which was
  deliberately not installed.

**NOT VERIFIED, needs checking on real Windows**

- Always-on-top above other windows; transparency and rounded corners. Check that there's no
  invisible area that blocks clicks.
- DPI scaling at 125% / 150%, and no size drift while dragging.
- Dragging in both states, and click-versus-drag detection.
- Focus going back to the previous app on collapse, and the compact card never stealing typing.
- The sleep/resume gap prompt (sleep the PC with a timer running).
- Launch at startup (installed build).
- Global shortcuts and the error message when a shortcut is already taken.
- Desktop notifications and sound.
- The NSIS installer (choosing an install folder), the portable exe, and the unsigned-build
  SmartScreen warning.

### Manual Windows test checklist

1. Install from the Actions artifact and get past SmartScreen (More info → Run anyway).
2. The card appears top-left. Click it, add a task with a finish condition, and press Start.
3. Click into another app and type: keystrokes must go to that app, not Monolith.
4. Drag the card around, including onto a second monitor if you have one. Restart the app; it
   should come back where you left it.
5. Expand, then press Esc: focus should return to the app you were using.
6. Press `Ctrl+Alt+P` to pause and resume, and `Ctrl+Alt+Space` to toggle the panel.
7. Set a 1-minute countdown and let it expire: you should get a notification and a beep.
8. Start a timer, put the PC to sleep for 1 minute, wake it: the gap prompt should appear.
   Try both answers.
9. Start a timer, kill Monolith in Task Manager, wait 30 s, start it again: you should get the
   gap prompt.
10. Set display scaling to 150% and repeat steps 2 and 4.
11. Turn on "Start with Windows" in the tray, sign out and back in.
12. Try the finish ritual with a wrong phrase (rejected) and the exact phrase (accepted).

---

## Exact commands on Windows

```powershell
git clone https://github.com/16JoeTheCoder/16JoeTheCoder.git
cd 16JoeTheCoder
git checkout claude/loving-allen-k9gnvu
npm ci
npm test
npm run dev               # try it without installing
npm run package:win       # release\Monolith-Setup-1.0.0.exe and release\Monolith-Portable-1.0.0.exe
```
