import type { CounterId, CustomerPhase, Manager } from './types';

/** Detached, transient QA facts. Never stored in SliceState or economic event IDs. */
export interface RouteTraceEvent {
  time: number;
  actor: 'customer' | 'manager';
  kind: 'spawn' | 'phase' | 'crossing' | 'despawn' | 'passage' | 'collected' | 'deposited';
  x: number;
  z: number;
  customerId?: number;
  counterId?: CounterId;
  phase: CustomerPhase | Manager['phase'];
  routeLeg?: number;
  legacy?: boolean;
  hasCup?: boolean;
  target?: number;
  amount?: number;
  pendingBefore?: number;
  pendingAfter?: number;
  carryingBefore?: number;
  carryingAfter?: number;
  walletBefore?: number;
  walletAfter?: number;
  /** Crossing centreline, not a collision/clearance verdict. */
  crossingX?: number;
}
export type RouteObserver = (event: Readonly<RouteTraceEvent>) => void;
