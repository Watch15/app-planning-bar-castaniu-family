# Backlog — Planning Bar

Registry of identified bugs, pending enhancements, and future features.
Add new items with a short description, context, and priority. Remove or move to `done` when resolved.

---

## Bugs

| ID | Description | Area | Priority |
|---|---|---|---|
| B-01 | ~~Mobile rounding errors~~ — **Fixed**: `_touchActive` flag blocks synthetic `mousedown` fired by Android after `touchstart`, which was overwriting `startX` and causing double `onUp()` saves with wrong deltas | Timeline / Touch | ~~Medium~~ Done |
| B-02 | UI responsiveness issues on very small screens — some modals or panels overflow or lose padding | CSS / Mobile | Medium |
| B-03 | Mobile validation button click audit needed — `pointerdown` vs `click` event handling on iOS/Android may miss taps on some modal confirm buttons | Mobile / Events | Low |

---

## Pending Enhancements

| ID | Description | Area | Priority |
|---|---|---|---|
| E-01 | Group filtering in the staff bar — filter by multiple roles simultaneously or by establishment group | Staff bar | Medium |
| E-02 | Copy week to next week — already partially implemented (modal with two sections); verify edge cases (jokers, cross-establishment) | Timeline | Low |

---

## Feature Requests

| ID | Description | Area | Notes |
|---|---|---|---|
| F-01 | Export weekly schedule as PDF / print view | Planning | Print styles already partially present in index.html |
| F-02 | Push notification opt-in flow — in-app prompt to subscribe (currently relies on manual trigger) | PWA / Push | VAPID infra already in place |

---

## Done

| ID | Description | Resolved in |
|---|---|---|
| D-01 | Week view colour contrast on tabs Jour/Semaine against light background | bb6cab3 |
| D-02 | Total hours per row in timeline had contrast issues | 3a310d0 |
| D-03 | Copy-week modal missing styles (section, label, grid) | 2ba4fe5 |
| D-04 | Copy week to next week — two-section modal implementation | 9396d05 |
| D-05 | Story #1: Mobile snap precision — `_touchActive` flag prevents synthetic `mousedown` during touch from corrupting drag state | (current) |
| D-06 | Story #2: Dynamic timeline hours — `applyVenueHours()` reads `open_time`/`close_time` from establishment data and updates `START_HOUR`/`END_HOUR`/`TOTAL_HOURS` before each timeline render | (current) |

---

## Notes for agents

- When fixing B-01 (mobile rounding): use `Math.round()` or integer pixel values for timeline block `left` and `width` calculations. Do not use `toISOString()` anywhere near date calculations (see `docs/architecture.md` §3.1).
- When working on any timeline feature: test drag, resize, and snap behaviour on both desktop and a 390px-wide mobile viewport.
- `script.js` is monolithic — add fixes there, do not split into modules (see `docs/architecture.md` §3.3).
