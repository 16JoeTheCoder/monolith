# Changelog

## 0.2.0

Simpler, quieter, and ready to share. All 0.1 rules still apply.

### Added
- **Daily record** of focus per local day and hour, deep time (stretches of 15+ min), pauses,
  and started/finished/dropped counts. It survives task deletion.
- **Self-grade** after the finish phrase: Fully, Mostly or Barely, stored in a journal of
  finishes.
- **Finish summary** for 5 seconds after a finish: time spent, estimate, start latency, banked
  total, chain.
- **Drop reasons:** "Blocked by something outside my control" (no penalty) or "I lost focus or
  interest" (orphans the task's time and resets the chain).
- **Done tab metrics:** Banked, Orphaned and Chain; this week's finished/started/fully line;
  the Focus Index (0-100, with a calibration gate, five parts, shrinkage and a confidence
  label); lifetime focus per day with a 7-day average; start latency; estimate calibration; a
  20-week heatmap; personal bests.
- **Queue tab:** "Today: Xh Ym focused", live and covering every task.
- **Estimate pace hint** in the task forms once your estimates are calibrated, plus an "Est. ·
  left/over" line on the Focus tab.
- **Appearance:** card opacity 0-100%, sizes for the status row, title, digits and progress
  bar, four themes (Graphite, Midnight, Ember, Forest), a custom accent colour, a live preview
  and a Reset button. The compact window now fits the card's width as well as its height.
- **Compact card polish:** a coloured state edge, an amber progress bar in the last 10%, small
  caps labels, bolder digits and a priority dot.
- **Ship-readiness:** a one-time welcome card, an error boundary with *Restart Monolith*, a
  crash log at `%APPDATA%\Monolith\logs\monolith.log` (1 MB rotation), Settings → About with
  the version and *Reset all data*, and GitHub Releases on `v*` tags.

### Changed
- The data format is now **v2**. A 0.1 file is backed up once to `state.v1.bak.json` and
  migrated automatically; history and totals are kept.
- Priority and estimate now sit directly in the add and edit forms. The "More" section is gone.
- The In Focus row no longer shows tracked time.
- Installer and portable exe are named `Monolith-Setup-0.2.0.exe` and
  `Monolith-Portable-0.2.0.exe`.

### Removed
- Money: value, earned income, currency and the money line on the card.
- Task notes and deadlines.

### Cut
- Nothing from the 0.2 plan was cut.

## 0.1.0

First version: one active task with a queue, mandatory finish condition, typed finish phrase,
drop to the back of the queue, countdown/Pomodoro/stopwatch timers based on timestamps, the
sleep/crash gap prompt, the crash-safe JSON store, the draft model with "Save Changes &
Collapse", and the top-left draggable overlay. (Its package.json said 1.0.0.)
