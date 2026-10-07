# Coffee v16: isolated cloud/browser QA

This folder contains 105 application/source files copied byte-for-byte from commit `94c1ba2515e0f34fe64baa98cd932e4a28589849`. `SOURCE-MANIFEST.json` records every path, byte length, SHA-256 and Git blob hash. The new QA tools are separate from those files. This is an additive test fixture on a QA branch, not a deployment or a replacement for the repository's main app.

No hosting binding, Site history, private account data, credentials, user screenshots or historical run reports are included. The server uses only generated game states, one synthetic identity and an in-memory database, listening on loopback. It never connects to production. Browser contexts are fresh and block requests to other origins. This verifies local gameplay/visuals, not real account login or production persistence.

## Setup and checks

Use Node 24 or newer and work inside `qa/site-v16`:

```sh
npm ci
node qa-tools/verify.mjs
npm run typecheck
npm test
node qa-tools/build.mjs
node --test qa-tools/server.test.mjs
```

Use `qa-tools/build.mjs` here. The preserved production `npm run build` includes a hosting-manifest copy, intentionally unavailable in this export. The QA builder creates the identical client and Worker code without that deployment packaging step. Never create a fake hosting manifest to run the production packager.

## Actual browser screenshots

Use the environment's supported browser workflow and its normal Chromium. If Playwright is already installed elsewhere, set `COFFEE_PLAYWRIGHT_MODULE` to its verified absolute module path. If needed, install the official npm package into this isolated folder without rewriting the exported manifests:

```sh
npm install --no-save --package-lock=false playwright
```

If the environment supplies a system Chromium, set `COFFEE_CHROMIUM` to that verified executable path. The runner explicitly enables `chromiumSandbox: true`, adds no renderer/security-disabling flags and does not use an existing user profile. If sandboxed launch is blocked, report that blocker without removing the sandbox or adding a fallback:

```sh
node qa-tools/browser.mjs
```

It launches a loopback-only synthetic server and records desktop and phone-sized PNGs under `qa-tools/evidence/`, along with render/request/error observations in `report.json`. Open the actual PNGs to judge pixels. The runner intentionally does not declare visual acceptance just because screenshots were created. Do not commit generated evidence or node_modules/dist files.

Optional arguments select scenarios, for example `node qa-tools/browser.mjs counter-wait seat-wait`. Scenarios:

- `initial`: empty paused shop for normal UI, zoom and renovation interaction.
- `partial-expansion`: width at maximum, one depth step remaining; only the remaining expansion direction should appear.
- `maximum-expansion`: both directions complete; no plus sign or post, both expansion buttons hidden, existing floor/furniture controls retained.
- `counter-wait`: valid paid guest at a reversed counter waiting for an exit route. It should face the counter until moving away.
- `seat-wait`: valid finished diner still physically on a chair. It should face the table until actually leaving.
- `brewing-level14`: upgraded espresso preparation. The progress display ends at readiness; the separate 0.70s handoff still occurs.

These are live simulations after startup. Route-wait poses can change before a slow screenshot; inspect `report.json`'s captured phases/positions and repeat deliberately if the target state has already passed. Do not mistake a moving departure for the waiting case. Phone-sized Chromium screenshots are not physical-iPhone verification.

For an interactive local browser session, run `node qa-tools/server.mjs` and use the exact printed origin through the environment's supported forwarding/browser tools. A fresh page without a seeded scenario creates a synthetic new shop. `/__qa/health` lists available scenarios; `/__qa/seed?scenario=NAME` returns only synthetic initial storage entries for a fresh test context. The runner demonstrates initializing those entries before navigation. `/__qa/requests` records methods/paths only. Stop the server when finished.

The preserved `qa/sites/browser-smoke.mjs` is reference-only in this export. It predates the explicit sandbox option and stays byte-identical for source provenance; do not use it as a browser entry point. Use `qa-tools/browser.mjs` for this QA run.

## Provenance and boundaries

Run `node qa-tools/verify.mjs` after checkout and after any tooling work. A failure means a v16 source file changed; resolve that before claiming v16 QA. The GitHub QA-branch commit is intentionally different from the original source commit because private history/metadata were not mirrored. Existing root workflows and app files remain unchanged. Do not merge, deploy, alter sharing, or use production data as part of this QA task.
