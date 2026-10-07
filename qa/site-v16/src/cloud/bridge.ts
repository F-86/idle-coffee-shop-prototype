import type {StorageLike} from '../slice/core/persistence';
import type {AuthorityClient} from './authority';
import type {ManualSync} from './manual';
let storage:StorageLike;let manual:ManualSync|null=null;
export function setCloudStorage(value:StorageLike){storage=value;}
export function cloudStorage():StorageLike{if(!storage)throw Error('Local save not initialized');return storage;}
// Retained compatibility seam for historical test fixtures; production is local.
export function getAuthority():AuthorityClient|null{return null;}
export function getManualSync(){return manual;}
export function setManualSync(value:ManualSync){manual=value;}
