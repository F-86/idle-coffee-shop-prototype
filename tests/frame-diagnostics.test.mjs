import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameDiagnostics, FRAME_SAMPLE_LIMIT } from '../src/slice/qa/FrameDiagnostics.ts';

test('TC-3D-015 rendered cadence uses caller monotonic timestamps and nearest-rank percentiles', () => {
  const d = new FrameDiagnostics();
  d.frame(1000);
  assert.equal(d.read().fps, null);
  for (const time of [1010, 1030, 1060, 1100, 1150, 1210, 1310, 1510]) d.frame(time);
  const s = d.read();
  assert.equal(s.intervals, 8); assert.equal(s.spanMs, 510);
  assert.equal(s.fps, 8000 / 510); assert.equal(s.p50Ms, 40); assert.equal(s.p95Ms, 200);
  assert.equal(s.maxMs, 200); assert.equal(s.over50, 3); assert.equal(s.over100, 1);
  assert.equal(s.totalIntervals, 8); assert.equal(s.totalFps, s.fps);
  for (const time of [1510, 1510, 1400, NaN, Infinity]) d.frame(time);
  assert.deepEqual(d.read(), s, 'duplicates/invalid time do not manufacture frames or poison the reference');
});

test('TC-3D-015 rolling window excludes old intervals while lifetime aggregates retain stalls', () => {
  const d = new FrameDiagnostics(); d.frame(0); d.frame(200);
  for (let time = 210; time <= 11000; time += 10) d.frame(time);
  const s = d.read();
  assert.equal(s.intervals, 1000); assert.equal(s.spanMs, 10000);
  assert.equal(s.fps, 100); assert.equal(s.p50Ms, 10); assert.equal(s.p95Ms, 10);
  assert.equal(s.over50, 0); assert.equal(s.totalOver50, 1); assert.equal(s.totalOver100, 1);
  assert.equal(s.totalMs, 11000);
});

test('TC-3D-015 a long foreground stall is retained whole and never mistaken for hidden time', () => {
  const d = new FrameDiagnostics(); d.frame(0); d.frame(20_000);
  const s = d.read();
  assert.equal(s.spanMs, 20_000); assert.equal(s.p95Ms, 20_000); assert.equal(s.over100, 1);
  assert.equal(s.intervals, 1); assert.equal(s.fps, .05);
  d.reset('hidden/resumed'); d.frame(60_000); d.frame(60_016);
  assert.equal(d.read().p95Ms, 16); assert.equal(d.read().totalMs, 16);
  assert.equal(d.read().totalOver50, 0); assert.equal(d.read().reason, 'hidden/resumed');
});

test('TC-3D-015 fixed rings stay bounded at high refresh and expose capacity truncation', () => {
  const d = new FrameDiagnostics();
  const arrays = [d.ends, d.intervals];
  for (let i = 0; i <= FRAME_SAMPLE_LIMIT; i++) d.frame(i);
  assert.equal(d.read().capacityLimited, false, 'a full ring has not necessarily dropped anything');
  d.frame(FRAME_SAMPLE_LIMIT + 1);
  assert.equal(d.read().capacityLimited, true, 'the first overwritten recent endpoint is reported');
  d.reset('capacity test');
  for (let i = 0; i <= 100_000; i++) d.frame(i);
  const s = d.read();
  assert.equal(s.retained, FRAME_SAMPLE_LIMIT); assert.equal(s.intervals, FRAME_SAMPLE_LIMIT);
  assert.equal(s.capacityLimited, true); assert.equal(s.totalIntervals, 100_000);
  assert.equal(d.ends, arrays[0]); assert.equal(d.intervals, arrays[1]);
  assert.equal(arrays[0].byteLength + arrays[1].byteLength, 65_536);
  assert.equal(s.fps, 1000);
  for (let i = 1; i <= 3000; i++) d.frame(100_000 + i * 10);
  assert.equal(d.read().capacityLimited, false); assert.equal(d.read().intervals, 1000);
});

test('TC-3D-015 read snapshots cannot mutate retained diagnostics', () => {
  const d = new FrameDiagnostics(); d.frame(0); d.frame(16);
  const s = d.read(); s.p95Ms = 999; s.totalIntervals = 0;
  assert.equal(d.read().p95Ms, 16); assert.equal(d.read().totalIntervals, 1);
});
