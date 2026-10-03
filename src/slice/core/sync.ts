import { validateState } from './persistence';
import type { SliceState } from './types';

export interface AuthIdentity { status: 'guest' | 'signed-in' | 'unconfigured'; userId: string | null; message: string }
export interface AuthProvider { getIdentity(): Promise<AuthIdentity> }
export class GuestAuthProvider implements AuthProvider {
  async getIdentity(): Promise<AuthIdentity> { return { status: 'guest', userId: 'guest', message: '本地试玩。iCloud / CloudKit 未配置。' }; }
}
export class UnconfiguredCloudKitAuthProvider implements AuthProvider {
  async getIdentity(): Promise<AuthIdentity> { return { status: 'unconfigured', userId: null, message: '尚未配置 Apple CloudKit container、环境或账户。' }; }
}
export interface SaveRecord { state: SliceState; recordChangeTag: string }
export type RemoteSaveResult = ({ status: 'saved' | 'conflict' } & SaveRecord) | { status: 'invalid-state' | 'operation-mismatch'; message: string };
/** An opaque recordChangeTag is only compared for equality, never interpreted. */
export interface SaveRepository {
  load(userId: string): Promise<SaveRecord | null>;
  save(userId: string, state: SliceState, expectedRecordChangeTag: string | null, operationId: string): Promise<RemoteSaveResult>;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Executable test adapter, not an actual cloud connection. Conflicts require reload, not wallet merges. */
export class InMemorySaveRepository implements SaveRepository {
  private records = new Map<string, SaveRecord>();
  private operations = new Map<string, { fingerprint: string; result: RemoteSaveResult }>();
  private sequence = 0;
  async load(userId: string): Promise<SaveRecord | null> { const record = this.records.get(userId); return record ? clone(record) : null; }
  async save(userId: string, state: SliceState, expectedRecordChangeTag: string | null, operationId: string): Promise<RemoteSaveResult> {
    if (!userId || !operationId || operationId.length > 256) return { status: 'invalid-state', message: '账户或操作标识无效。' };
    const checked = validateState(state);
    if (!checked.ok) return { status: 'invalid-state', message: checked.message };
    const key = JSON.stringify([userId, operationId]);
    const fingerprint = JSON.stringify([checked.state, expectedRecordChangeTag]);
    const previous = this.operations.get(key);
    if (previous) return previous.fingerprint === fingerprint ? clone(previous.result) : { status: 'operation-mismatch', message: '同一操作标识不能用于不同请求。' };
    const current = this.records.get(userId);
    let result: RemoteSaveResult;
    if ((current?.recordChangeTag ?? null) !== expectedRecordChangeTag) {
      // A conflict never applies or combines money earned by an offline branch.
      result = current ? { status: 'conflict', ...clone(current) } : { status: 'invalid-state', message: '记录不存在，请重新读取。' };
    } else {
      const recordChangeTag = `memory-record-${++this.sequence}-opaque`;
      const record = { state: clone(checked.state), recordChangeTag };
      this.records.set(userId, record); result = { status: 'saved', ...clone(record) };
    }
    this.operations.set(key, { fingerprint, result: clone(result) });
    return result;
  }
}
