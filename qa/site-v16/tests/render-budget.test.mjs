import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderBudget, RENDER_MODES, RENDER_MODE_KEY, readRenderMode, renderPixelRatio } from '../src/slice/render/RenderBudget.ts';

for (const hz of [30, 60, 90, 120, 144, 240]) {
  test(`TC-3D-012 smooth follows every ${hz}Hz display refresh with equal time intervals`, () => {
    const budget = new RenderBudget(0);
    let frames = 0, elapsed = 0;
    for (let n = 1; n <= hz * 10; n++) {
      const dt = budget.take(n * 1000 / hz);
      assert.notEqual(dt, null);
      assert.ok(Math.abs(dt - 1 / hz) < 1e-10);
      frames++; elapsed += dt;
    }
    assert.equal(frames, hz * 10);
    assert.ok(Math.abs(elapsed - 10) < 1e-9);
  });
  for (const mode of ['clear-60', 'balanced', 'low-power']) {
    test(`TC-3D-012 explicit ${mode} on ${hz}Hz drops renders without losing time`, () => {
      const budget = new RenderBudget(0, mode);
      let frames = 0, elapsed = 0;
      for (let n = 1; n <= hz * 10; n++) {
        const dt = budget.take(n * 1000 / hz);
        if (dt !== null) { frames++; elapsed += dt; }
      }
      assert.equal(frames, Math.min(hz, RENDER_MODES[mode].fps) * 10);
      assert.ok(Math.abs(elapsed - 10) < 1e-9);
    });
  }
}

test('TC-3D-012 delayed/duplicate/invalid RAFs never replay; reset excludes hidden time', () => {
  const budget = new RenderBudget(0);
  assert.equal(budget.take(1000), 1);
  assert.equal(budget.take(1000), null);
  assert.equal(budget.take(NaN), null);
  assert.equal(budget.take(999), null);
  budget.reset(90000);
  assert.ok(Math.abs(budget.take(90016) - .016) < 1e-9);
});

test('TC-3D-012 changing quality preserves exactly one pending visible tail', () => {
  const budget = new RenderBudget(0, 'low-power');
  assert.equal(budget.take(10), null);
  budget.setMode('smooth', 11);
  assert.equal(budget.take(16), .016);
  budget.setMode('balanced', 20);
  assert.equal(budget.take(25), null);
  assert.equal(budget.take(40), .024);
  assert.equal(budget.flush(45), .005);
  assert.equal(budget.flush(45), 0);
});

test('TC-3D-012 crisp default restores Retina samples, explicit modes bound large buffers', () => {
  assert.equal(renderPixelRatio(1280, 900, 2), 2);
  assert.equal(renderPixelRatio(390, 844, 3), 2);
  assert.equal(renderPixelRatio(1280, 900, 2, 'balanced'), 1.5);
  assert.equal(renderPixelRatio(1280, 900, 2, 'low-power'), 1);
  for (const mode of Object.keys(RENDER_MODES)) {
    for (const [width, height, dpr] of [[1280, 900, 2], [390, 844, 3], [844, 390, 2], [3840, 2160, 2], [1920, 1080, 1]]) {
      const ratio = renderPixelRatio(width, height, dpr, mode);
      assert.ok(ratio > 0 && ratio <= Math.min(dpr, RENDER_MODES[mode].maxDpr));
      assert.ok(width * height * ratio ** 2 <= RENDER_MODES[mode].maxPixels + 1e-6);
    }
  }
  assert.equal(renderPixelRatio(390, 844, .8), .8);
  assert.equal(renderPixelRatio(390, 844, NaN), 1);
});

test('TC-3D-012 malformed/blocked preferences select smooth without touching the game save', () => {
  for (const mode of ['smooth', 'clear-60', 'balanced', 'low-power']) assert.equal(readRenderMode({ getItem: key => { assert.equal(key, RENDER_MODE_KEY); return mode; } }), mode);
  for (const value of [null, '', 'fast', '{}', 'toString', '__proto__']) assert.equal(readRenderMode({ getItem: () => value }), 'smooth');
  assert.equal(readRenderMode({ getItem() { throw new Error('blocked'); } }), 'smooth');
});


test('TC-3D-016 clear-60 keeps exactly the smooth resolution budgets at every viewport', () => {
  assert.deepEqual(RENDER_MODES['clear-60'], { fps: 60, maxDpr: 2, maxPixels: 8_000_000 });
  assert.equal(renderPixelRatio(1280, 900, 2, 'clear-60'), 2);
  for (const [width, height, dpr] of [[1280, 900, 2], [1672, 1037, 2], [390, 844, 3], [844, 390, 2], [3840, 2160, 2], [1920, 1080, 1], [390, 844, .8], [390, 844, NaN]]) {
    assert.equal(renderPixelRatio(width, height, dpr, 'clear-60'), renderPixelRatio(width, height, dpr, 'smooth'));
  }
});

test('TC-3D-016 clear-60 switches preserve pending time and never replay slow or hidden frames', () => {
  const budget = new RenderBudget(0, 'smooth');
  assert.equal(budget.take(8), .008);
  budget.setMode('clear-60', 10);
  assert.equal(budget.take(16), null);
  assert.equal(budget.take(27), .019);
  assert.equal(budget.take(1027), 1, 'a long visible frame settles once');
  assert.equal(budget.take(1027), null);
  budget.reset(90000);
  assert.equal(budget.take(90008), null);
  assert.equal(budget.take(90017), .017);
  budget.setMode('smooth', 90020);
  assert.equal(budget.take(90025), .008);
  assert.equal(budget.flush(90030), .005);
  assert.equal(budget.flush(90030), 0);
});
