// Optional exact long-duration verification. Node 24; isolated in-memory saves only.
// Run: node scripts/offline-performance.mjs. Reports measured time, not an estimate.
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const root = new URL('../', import.meta.url);
const { createInitialState } = await import(new URL('src/slice/core/engine.ts', root));
const { LocalSaveRepository, createMemoryStorage, validateState, SAVE_KEY } = await import(new URL('src/slice/core/persistence.ts', root));

async function sample(days) {
  const memory = createMemoryStorage(), repo = new LocalSaveRepository(memory);
  repo.save(createInitialState(), 1_000_000);
  let yields = 0, lastPercent = 0, maxSlice = 0, lastYield = performance.now();
  const began = performance.now(), bytes = memory.getItem(SAVE_KEY);
  const pending = repo.load(1_000_000 + days * 86_400_000, { deferOffline: true });
  const result = await repo.finishOffline(pending.pending, {
    yieldControl: () => new Promise(resolve => setTimeout(() => {
      yields++;
      lastYield = performance.now();
      resolve();
    }, 0)),
    onProgress(progress) {
      if (yields) maxSlice = Math.max(maxSlice, performance.now() - lastYield);
      const percent = Math.floor(progress.fraction * 100);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        console.log(JSON.stringify({ days, progress: percent, elapsedMs: performance.now() - began }));
      }
      if (progress.fraction < 1 && memory.getItem(SAVE_KEY) !== bytes) throw Error('Partial save before completion');
    },
  });
  const state = result.state;
  const assets = state.wallet + state.spend + state.manager.carrying + state.counters.reduce((sum, counter) => sum + counter.pendingCash, 0);
  const evidence = {
    days, status: result.status, wallMs: performance.now() - began, yields, maxSliceMs: maxSlice,
    elapsed: state.elapsed, expectedElapsed: days * 86400 * .8,
    wallet: state.wallet, generated: state.totalEarned,
    pending: state.counters.map(counter => counter.pendingCash), carrying: state.manager.carrying,
    customers: state.customers.length, claimCount: state.offlineClaimIds.length,
    valid: validateState(state).ok, conserved: assets === 1200 + state.totalEarned,
    savedBytes: memory.getItem(SAVE_KEY).length, memoryMB: process.memoryUsage().heapUsed / 1024 / 1024,
  };
  console.log(JSON.stringify(evidence));
  if (evidence.status !== 'loaded' || !evidence.valid || !evidence.conserved || evidence.elapsed !== evidence.expectedElapsed || evidence.claimCount !== 1) throw Error('Long-duration verification failed');
}
await sample(7);
await sample(30);
