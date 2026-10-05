# Offline earnings lifecycle: macOS CUA limits and correction

## Report scope

This report corrects the task attribution for the 2026-10-05 CUA run. The task was the ba7/a28 offline-earnings lifecycle check, not a Clear60 performance run. It supersedes the mistaken task scope in the prior Library version while preserving that version in Library history.

The earlier b1 Clear60 run remains completed as recorded: Smooth → Clear60 → Smooth, with target caps of 120 / 60 / 120 FPS and actual sample durations of 89.29 / 98.55 / 88.31 seconds; render-mode persistence was verified. This offline lifecycle correction does not replace or invalidate that result.

## Run identity and setup

- Date: 2026-10-05 (UTC)
- Source revision: `a28bb6707ec71a1e4a4631a558ae5e5f8d286c1c`
- Source tree: `2c5138b6e830d2fab6dc92302349ac1fcf2a4c9a`
- Browser automation was available and the Chrome UI and QA page were accessible.
- Preview/test origin: `http://127.0.0.1:4182/?qa=1`, with an independent QA save. The daily-origin save was not opened.
- The independent QA store was saved via the app UI. Its read-only envelope indicated `offlinePolicyVersion: 2`. This is test-store setup evidence only.

## Lifecycle acceptance

| Check | Result | Evidence / limit |
|---|---|---|
| Independent policy-v2 test store | PASS (setup only) | In-app Save progress confirmation; read-only QA envelope reported policy version 2. No save payload is included. |
| Foreground/hidden visibility transitions | INCONCLUSIVE | One tab-switch attempt showed the QA tab unselected in Chrome while read-only page evaluation still returned `visibility="visible"` and `hidden=false`. The browser visibility transition was not observable consistently. |
| Close tab and reopen | NOT RUN | The test tab was closed during cleanup; no reopen lifecycle was observed. |
| Short-interval background/foreground accrual | NOT VERIFIED | No reliable hidden/visible transition and matching elapsed/effective values were captured. |
| Single offline settlement / claim | NOT RUN | No browser settlement was performed or observed. |
| Duplicate-claim prevention | NOT RUN | No browser retry or repeat-claim evidence was collected. |
| Legacy-save browser migration | NOT RUN | No safe legacy browser fixture was available. Do not infer a browser migration pass. |
| Automated offline-boundary suite | Existing report: 210/210 PASS; not rerun here | The existing suite uses simulated time and covers boundary/migration cases. It is not real-browser lifecycle evidence. |

No clock or timer was changed, no page script or localStorage state was injected, and no state was forced. No customer or wallet data is reported. No browser lifecycle pass is claimed for visibility, reopen, settlement, or duplicate prevention.

## Cleanup

- The Mellow Bean QA tab was closed.
- The local preview on port 4182 was stopped; the retained terminal check found no listener.
- Other tabs and services were left alone.

## Remaining browser evidence

A future isolated-origin QA run would need reliable visibility/focus transition capture, followed by close/reopen, one settlement, and a read-only check that repeating the claim cannot settle twice. Keep this separate from the previously completed b1 Clear60 performance record.
