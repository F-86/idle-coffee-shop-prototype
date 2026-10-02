# Scene event/snapshot reconciliation regression

Date: 2026-10-02, UTC. Base commit: `5e46ab482dfc246f467c599ecc90f06d215c9b85`.
Scope: existing Phaser customer-departure behavior, implementing REQ-QUEUE-001/002 and the no-return-to-queue assertion in TC-QUEUE-002. No new product rule, economy parameter, artwork, CSS, saved-state schema, or deployment change.

## Finding and correction

`cup-delivered` is dispatched synchronously by the core, while `app.js` refreshes scene snapshots at a 120ms interval. The event starts the customer's departure. On the next Phaser frame, the old snapshot still lists that customer in the queue. Previously `draw()` canceled the departure tween, reset `leaving`, and overwrote the departure label. The next fresh snapshot then removed the actor without completing its exit.

`draw()` now preserves event-owned departing actors while reconciling queued customers. Removal remains owned by the exit tween's completion; other customers continue to enter and move forward normally. This changes rendering reconciliation only, not core events or money.

## Actual verification

Node v24.19.0; command `npm run test:scene`. The tests import the production TypeScript scene with Node module hooks. Only Phaser display objects and tween scheduling are stubbed; this is a renderer-unit check, not browser/visual acceptance.

- Before correction: departure regression FAIL (`3 !== 2` tween cancellations after stale draw); ordinary queue reconciliation PASS.
- After correction: 2/2 PASS. Covers event → repeated stale frames → refreshed queue → departure completion and cleanup; also ordinary queue advancement/removal.
- `node --check app.js`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, existing large-bundle warning remains.
- `git diff --check`: PASS.

Browser TC-QUEUE-002: NOT_RUN. The normal scene still hides Phaser and displays a baked example world. The unit check cannot establish correct visible customer departure or Figma fidelity, and this patch does not claim that it does. Browser regression must run after the dynamic scene becomes visible, with UI-triggered handoff and consecutive frames through departure and replacement.

## Remaining visual split blocker

The current world image includes sample actors, menus, prices, cash and counter states. Simply displaying Phaser again duplicates those pixels; replacing it with a blank/static shell alone removes gameplay feedback. The live native export packet has lossless component PNGs and hierarchy, but omits vector paths, transform matrices, rotation, full effects and complete style tokens. A screenshot is a comparison reference, not a substitute for the required high-fidelity design implementation source.

Required design-context branches for a complete split: actual world `46:2834` / room `55:4363`, including menu `27:454`, vault `51:3931`, open counter `36:1671`, locked counter `36:1714`, rug `37:1879`, barista `37:1980`, manager `37:1999`, entrance `37:1891`, plus all visible wall/floor/trim branches. Correlate these to a screenshot and obtain high-fidelity child responses with exact local asset mappings. Existing HUD/customer context is narrower. No exhausted remote quota was retried, and no Figma nodes were mutated.

The live design shows eight station slots; the current business engine has three counters and five recipes. A visual integration must preserve the existing playable keys and cannot silently manufacture the other stations' economics or treat authored sample prices/locks as runtime truth. Any expansion beyond those rules needs an explicit product decision.

## Independent Mac review and verification

2026-10-02, macOS arm64, Node v22.23.0 / npm 10.9.8. The Library ZIP SHA256 `175bc7432485f8f6ddceed3b05c29ea48e7b1b8fae6f5e90bcede7706d12a77a`, patch SHA256 `2a07df59f1d96b4e5e567e01fff9d61d25f84fdbd163619324b57d7536d8f7bb`, and all five applied-file hashes matched the supplied manifest before this local report extension. Local HEAD and remote main both matched the base. No pre-existing tracked or untracked changes were present.

Independent review confirmed the leaving guard executes before queued node/tween/label updates. The exit completion still owns cleanup; ordinary queue movement/removal remains exercised. Core economics, artwork, CSS and deployment configuration were unchanged.

The two tests were rerun against the original scene: the stale-snapshot regression failed with `3 !== 2` cancellations, while ordinary reconciliation passed. Restoring the patched scene yielded 2/2 PASS. `node --check app.js`, `npm run typecheck`, `npm run build`, and patch whitespace validation passed. Full local command output is in [mac-verification.txt](mac-verification.txt).

The first sandboxed build was blocked by Vite writing its temporary config through the reused node_modules directory; the authorized rerun passed. Build output retained the existing chunk-size warning; Node emitted the TypeScript-stripping experimental warning. Neither changes the renderer-unit verification boundary.

Browser TC-QUEUE-002 remains NOT_RUN. Phaser is still hidden behind the baked world image. These results establish the internal event/snapshot regression only, not dynamic scene visibility, full browser acceptance or visual fidelity.
