# Figma / Q1 closeout browser run

Date: 2026-09-21 18:54 CST (Asia/Shanghai)
Initial commit: `559b604`
Initial worktree: dirty; this run exercised the current uncommitted implementation before its staged commits.

## Environment

- App: `http://127.0.0.1:5173/`, Vite dev server.
- Test contexts: Codex in-app browser and an isolated Chrome QA tab.
- Input: Browser-Use/Computer-Use through visible accessible names and pointer input.
- Visual source: Figma node `13:3`, exported world `1280 × 720`.
- Responsive viewport overrides exercised: 844 × 390 landscape, 667 × 375 landscape, 390 × 844 portrait; visual target override used a 1536 × 864 device frame and checked the resulting DOM geometry.
- Preparation: `FX-QUEUE-10` and `FX-LONG-RUN` test fixtures through the documented `test=fixture` entry. The fixture protects the normal save and does not expose business-result shortcuts.

## Results

| Case | Result | Evidence |
| --- | --- | --- |
| TC-UI-008 / REQ-UI-009 | PASS for browser visual baseline | Figma world asset filled the scene bounds in the Chrome capture; recipe/station/counter detail, picker, Escape restoration, keyboard traversal, queue labels, and business switch were reachable through the live UI. The accessibility tree exposed the scene summary and dynamic B/P/M values. |
| TC-QUEUE-003 / queue overflow | PASS for observable candidate behavior | `FX-QUEUE-10` began at B=¥200 and queue `10/10`. Three visible `推进 1 秒` clicks kept the queue at `10/10`; the third click displayed `→ 一号柜台已满位，顾客从右侧出口离店`. No second/third-counter queue was created. |
| TC-LOOP-002 / continuity | PASS for observable candidate behavior; formal economy assertion remains BLOCKED | Ten visible `推进 60 秒` clicks kept queues at `10/10` and `9/9`, then five visible close/advance-5s/reopen cycles froze the scene values while closed. A legal upgrade was completed in the counter dialog: B=¥6,124 → ¥5,904 and 一号柜台 Lv.1 → Lv.2. Exact `A=B+P+M` cannot be independently confirmed from the player UI because the candidate Q1 ledger remains draft. |

## Ten-minute UI sample

The following values were read from the live scene region after each visible
60-second control click. They are evidence of the candidate fixture's
continuity, not a product-approved balance table.

| Minute | B / 金库 | P / 待收 | M / 经理携款 | Queue 1 | Queue 2 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | ¥760 | ¥28 | ¥0 | 10/10 | 9/9 |
| 2 | ¥1,352 | ¥36 | ¥0 | 10/10 | 9/9 |
| 3 | ¥1,940 | ¥20 | ¥16 | 10/10 | 9/9 |
| 4 | ¥2,540 | ¥20 | ¥16 | 10/10 | 9/9 |
| 5 | ¥3,120 | ¥16 | ¥40 | 10/10 | 9/9 |
| 6 | ¥3,720 | ¥16 | ¥28 | 10/10 | 9/9 |
| 7 | ¥4,300 | ¥8 | ¥56 | 10/10 | 9/9 |
| 8 | ¥4,888 | ¥20 | ¥56 | 10/10 | 9/9 |
| 9 | ¥5,536 | ¥16 | ¥0 | 10/10 | 9/9 |
| 10 | ¥6,124 | ¥28 | ¥0 | 10/10 | 9/9 |

During each of the five pause cycles, B/P/M stayed at
`¥6,124 / ¥28 / ¥0` while the visible switch reported `已打烊`; after
reopening it reported `营业中` and the values remained unchanged.

## Console and responsive checks

- A fresh `/?test=console-clean` browser tab returned an empty error/warning
  log after Phaser was constrained to Canvas for the authored-background mode.
- The compact viewport checks reported no page-level horizontal overflow. The
  portrait case kept horizontal scrolling inside the world viewport, as
  specified by the layout rule.
- Representative compact controls measured at least 44 CSS pixels. The
  browser accessibility tree was checked; physical iOS/Android touch and a
  separate VoiceOver/TalkBack session were not available.

## Cleanup and boundary

The test fixtures were isolated and save-protected. The QA tab was left on the
queue fixture only during evidence capture and is ephemeral. No normal player
save was modified. Figma prototype connector wiring was not edited; the repo
uses the existing final Figma exports for coffee icons, customer/barista/
manager actors, station pads, and the world composite.

The Q1 parameter document remains explicitly `draft`/candidate. This report
must not be read as user confirmation of the economy values or of any still
open manager/capacity/pricing decisions.
