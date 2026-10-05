import { STEP_SECONDS, WORLD } from '../core/engine';
import { GRID } from '../core/layout';
import type { SliceEngine, SliceState } from '../core/types';

/**
 * Present the adjacent fixed-step snapshots, one 50ms step behind authority.
 * Positions/progress interpolate; cup ownership, phases and cash switch together
 * at the next boundary. No prediction, frame-rate-dependent easing, or core writes.
 */
export class FrameInterpolator {
  private previous: SliceState;
  private source: SliceState;

  constructor(state: SliceState) {
    this.source = state;
    this.previous = structuredClone(state);
  }
  reset(state: SliceState): void {
    this.source = state;
    this.previous = structuredClone(state);
  }
  advance(engine: SliceEngine, seconds: number): SliceState {
    if (this.source !== engine.state) this.reset(engine.state);
    // Only copy before the final step, even when a slow frame settles many steps.
    engine.advance(seconds, state => { this.previous = structuredClone(state); });
    return this.sample(engine.state);
  }
  sample(current: SliceState): SliceState {
    const alpha = Math.min(1, Math.max(0, (current.stepCarry ?? 0) / STEP_SECONDS));
    const mix = (a: number, b: number) => a + (b - a) * alpha;
    const customers = new Map(current.customers.map(customer => [customer.id, customer]));
    const counters = new Map(current.counters.map(counter => [counter.id, counter]));
    return {
      ...this.previous,
      paused: current.paused,
      customers: this.previous.customers.map(previous => {
        let next = customers.get(previous.id);
        if (!next && previous.phase === 'leaving') {
          // Core removes on reaching the boundary. Complete that final 50ms leg
          // in the delayed view too; freezing a removed body makes its follower
          // catch a stationary ghost before the next snapshot removes it.
          const endpoint = current.layout?.active ? GRID.exit : previous.finishLegacyRoute
            ? { x: WORLD.entryX, z: WORLD.entryZ }
            : { x: WORLD.exitX, z: WORLD.exitZ };
          next = { ...previous, ...endpoint };
        }
        return next ? { ...previous, x: mix(previous.x, next.x), z: mix(previous.z, next.z) } : previous;
      }),
      manager: { ...this.previous.manager, x: mix(this.previous.manager.x, current.manager.x), z: mix(this.previous.manager.z, current.manager.z) },
      counters: this.previous.counters.map(previous => {
        const next = counters.get(previous.id);
        const brew = previous.brew;
        // Never blend progress from a completed cup into a different customer's cup.
        return brew && next?.brew?.customerId === brew.customerId
          ? { ...previous, brew: { ...brew, elapsed: mix(brew.elapsed, next.brew.elapsed) } }
          : previous;
      }),
    };
  }
}
