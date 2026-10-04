import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderBudget, RENDER_FPS, MAX_RENDER_PIXELS, renderPixelRatio } from '../src/slice/render/RenderBudget.ts';

for (const hz of [30, 60, 90, 120, 144, 240]) {
  test(`TC-3D-011 ${hz}Hz refresh stays at 30 presentation frames/s without losing simulated time`, () => {
    const budget = new RenderBudget(0);
    let frames = 0, elapsed = 0;
    for (let n = 1; n <= hz * 10; n++) {
      const dt = budget.take(n * 1000 / hz);
      if (dt !== null) { frames++; elapsed += dt; }
    }
    assert.equal(frames, RENDER_FPS * 10);
    assert.ok(Math.abs(elapsed - 10) < 1e-9);
  });
}

test('TC-3D-011 slow frames do not replay renders; resume reset excludes hidden time', () => {
  const budget = new RenderBudget(0);
  assert.equal(budget.take(10), null);
  assert.equal(budget.take(1000), 1);
  assert.equal(budget.take(1001), null);
  assert.equal(budget.take(NaN), null);
  assert.equal(budget.take(999), null);
  budget.reset(90000);
  assert.equal(budget.take(90016), null);
  assert.ok(Math.abs(budget.take(90034) - .034) < 1e-9);
});

test('TC-3D-011 resolution budget caps Retina and large-screen buffers without changing CSS geometry', () => {
  for (const [width, height, dpr] of [[1280, 900, 2], [390, 844, 3], [844, 390, 2], [3840, 2160, 2], [1920, 1080, 1]]) {
    const ratio = renderPixelRatio(width, height, dpr);
    assert.ok(ratio > 0 && ratio <= Math.min(dpr, 1.25));
    assert.ok(width * height * ratio ** 2 <= MAX_RENDER_PIXELS + 1e-6);
  }
  assert.equal(renderPixelRatio(390, 844, .8), .8);
  assert.equal(renderPixelRatio(390, 844, NaN), 1);
  assert.equal(renderPixelRatio(1280, 900, 2), 1.25);
});
