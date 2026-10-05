# Independent cloud-browser QA: BLOCKED

Run date: 2026-10-05 UTC (task clock). Executor's Chromium stderr printed 2026-10-04 23:16–23:17; no OS/browser clock was changed.

## Target and isolation

- Repository: Mellow Bean; branch `codex/offline-80pct-unlimited`.
- HEAD at inspection: `8a8ea9767529b7deeeaf45a4aed20978a82284e4`, with current offline-policy worktree changes. This is not a claim that the changes were already committed.
- Intended test URL: `http://127.0.0.1:4177/?qa=1` using Vite on `127.0.0.1`, a dedicated test port.
- Intended browser: cloud Chromium 154.0.8037.57 (Debian 13), installed Playwright, disposable context/profile, desktop 1440×900 then narrow viewport.
- No user computer, existing personal browser profile, daily save, or production origin was accessed. No test save was seeded because browser launch/navigation never reached the app.
- No source files were modified by this QA pass.

## Attempts and observed blockers

1. `npm run dev -- --host 127.0.0.1 --port 4177 --strictPort` reported Vite 8.3.0 ready.
2. Standard installed Playwright launch using `/usr/bin/chromium`, headless, failed before any page was created:

   `FATAL:chrome/browser/process_singleton_posix.cc:297 Check failed: . socket() failed: Operation not permitted (1)`

   The first attempt additionally reported crashpad database setup errors. These are browser-startup messages, not application console errors.
3. The same isolated launch was retried once through the supported `require_escalated` command path. It still failed at the same ProcessSingleton socket restriction, with `ptrace: Operation not permitted` from crash reporting. No extra browser flags or environment changes were added to defeat the restriction.
4. The supported cloud-browser tool was tried through its documented `cdp` cloud-browser entry point. Opening the same URL failed with `net::ERR_BLOCKED_BY_CLIENT` before rendering. A subsequent attempt to bind the failed tab for cleanup was rejected by its URL policy (the browser error-page protocol is not allowed). No alternate origin, tunnel, security override, or indirect navigation was attempted.

The existing Vite test session was stopped after collecting the blocker. No other browser processes or user tabs were touched.

## Result by requested browser coverage

- BLOCKED: actual 3D scene rendering and pixels at desktop/narrow sizes.
- BLOCKED: progress dialog readability, responsive bounds, focus, and accessible cancellation controls.
- BLOCKED: result dialog distinctions between money deposited, newly generated revenue, and cash awaiting collection/transport.
- BLOCKED: cancel/Close/Escape then retry through settings.
- BLOCKED: original wallet and stored bytes remaining unchanged while settlement is pending.
- BLOCKED: hide/resume, BFCache, reload/duplicate settlement and real browser event ordering.
- BLOCKED: application-console error assessment. No page loaded, so there is no console-clean result.
- NOT_RUN: a synthetic 3-hour fixture or elapsed-time benchmark inside the browser.
- No screenshots were captured. Core or simulated DOM test evidence must not be treated as pixel evidence.

## Independent source check

PASS, source identity only: `src/slice/render/CoffeeScene.ts` is byte-for-byte equal by SHA-256 to the requested baseline commit. This verifies no scene-source change, not rendering quality.

SHA-256, inspected after the UI source was reported stable:

| File | SHA-256 |
| --- | --- |
| `src/slice/main.ts` | `fca894c216bfa6c4ed4ecf8b20148b8c0307af49dc800d47f6b5ce0ed3c1e5f1` |
| `src/slice/style.css` | `ecf1b49c99bd7a015a4e56aa6c1b44d65e17d9edf86fec5e4f15d573495f45f8` |
| `src/slice/core/engine.ts` | `2095a2e0b560349a4fddca144145a42008e160e0a6a397747aaddaf86baf8bd6` |
| `src/slice/core/persistence.ts` | `c80ce6bb02f92d7284d45e5cdb64a8aa4372377c011ac4a5fe0233c96c8e4dd7` |
| `src/slice/core/types.ts` | `71f227b1b1b5bda1362591c30a172898bbd80eb621f7dc1b4f087c6d7eedcd24` |
| `src/slice/render/CoffeeScene.ts` | `566a2be2640b953458c05e12c8858427ca4b886e6d24f98a3730e2d7e6c2c3c9` |

## Remaining verification

Run TC-3D-020 in an environment whose supported browser can access the test server, with a fresh, independent browser profile/origin. Use legitimate synthetic v3 and v1/v2 save envelopes with a 3-hour timestamp gap without altering the OS clock. Preserve preclaim bytes, capture pending and completed desktop/narrow screenshots, test all interrupted/repeated flows above, and compare settlement money and saved state against the fixed-step core oracle. Re-record hashes if source changes. A successful cloud run would still not establish Mac hardware frame rate, thermals, or device-specific presentation.
