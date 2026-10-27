import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {verifyState,emptyState} from '../finance.js';
export const CHUNK_SIZE=1024*1024;
export const MAX_FILE_SIZE=250*1024*1024;
export const MAX_STATE_BYTES=12*1024*1024;
export function sha256(buf){return createHash('sha256').update(buf).digest('hex')}
export function validId(x){return typeof x==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(x)}
export function safeName(s){if(typeof s!=='string')throw Error('Invalid filename');return s.replace(/[\\/\x00-\x1f]/g,'_').slice(0,180)||'document'}
export function checkState(next){
 verifyState(next);
 const bytes=Buffer.byteLength(JSON.stringify(next));if(bytes>MAX_STATE_BYTES)throw Error('Project metadata exceeds safe limit (12MB). Export an archive and contact administrator.');
 const fids=new Set();for(const f of next.files){if(!validId(f.id))throw Error('Invalid file ID');if(fids.has(f.id))throw Error('Duplicate file ID');fids.add(f.id);if(typeof f.name!=='string'||!f.name||!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_FILE_SIZE)throw Error('Invalid file metadata');}
 return true;
}
export function matchFile(meta,uploaded){return meta?.id===uploaded?.id && meta?.sha256===uploaded?.sha256 && meta?.size===uploaded?.size && meta?.type===uploaded?.type}
export function authConstantCompare(a,b){const x=createHash('sha256').update(a).digest(),y=createHash('sha256').update(b).digest();return timingSafeEqual(x,y)}
export function failure(status,message,code='ERROR'){let e=new Error(message);e.status=status;e.code=code;return e}
export function startupState(){return emptyState()}
export {randomUUID};
