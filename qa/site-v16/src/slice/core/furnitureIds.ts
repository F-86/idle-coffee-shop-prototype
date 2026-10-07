import type {CounterId} from './types';
export const LEGACY_COUNTER_IDS:readonly CounterId[]=['counter-a','counter-b','counter-c','counter-d'];
export function counterOrdinal(value:unknown):number{if(typeof value!=='string')return NaN;const old=LEGACY_COUNTER_IDS.indexOf(value as CounterId);if(old>=0)return old+1;if(!/^counter-[1-9]\d{0,15}$/.test(value))return NaN;const n=Number(value.slice(8));return Number.isSafeInteger(n)&&n>=5?n:NaN;}
export const isCounterId=(value:unknown):value is CounterId=>Number.isFinite(counterOrdinal(value));
export const compareCounterIds=(a:CounterId,b:CounterId)=>counterOrdinal(a)-counterOrdinal(b);
export function nextCounterId(ids:readonly string[]):CounterId{const used=new Set(ids);const legacy=LEGACY_COUNTER_IDS.find(id=>!used.has(id));if(legacy)return legacy;let n=5;while(used.has(`counter-${n}`))n++;return `counter-${n}`;}
