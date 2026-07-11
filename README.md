# Arithmetic Trainer

Zetamac-style mental-arithmetic sprint trainer as an installable PWA, with per-question
analytics for interview prep (80-in-8 etc.). No backend — every keystroke is logged to
`localStorage` on the device and analysed locally.

## Modes

- **Sprint** — classic zetamac: 30/60/120/300/480s, configurable operations and ranges.
  Defaults match zetamac exactly: addition (2–100)+(2–100), multiplication (2–12)×(2–100),
  subtraction and division as inverses (answers always small non-negative integers).
  Answers auto-accept the instant the correct value is typed — no submit key.
- **80 in 8** — 80 questions on default ranges against an 8-minute clock, the common
  interview benchmark. Ends early when you hit 80; records your finish time.

## Analytics

Every question stores `(operation, operands, ms-to-answer, wrong-entry count)`. The Stats
tab computes, filterable by mode and time window:

- pace (answers/min) per session over time with a 5-session rolling average
- median time and error rate per operation, plus a per-operation speed trend
- multiplication/division heatmaps: small factor × size of the other operand
- carrying/borrowing cost for addition/subtraction
- ranked weak spots and strengths by question archetype, normalised per-operation
- recent-session table, JSON export/import, full reset

## Install on iPhone

Open the GitHub Pages URL in Safari → Share → **Add to Home Screen**. Works fully
offline after the first load. Data stays in the installed app's storage — export a JSON
backup occasionally (iOS may evict storage of PWAs unused for several weeks).

## Development

Static files, no build. Serve the folder with any HTTP server, e.g.
`python -m http.server --directory . 8371`.
