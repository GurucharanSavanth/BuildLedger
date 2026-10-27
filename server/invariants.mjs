/* Checked on every versioned SQLite commit before altering any stored original. */
import {failure,validId} from './core.mjs';
const problem=msg=>failure(422,msg,'FILE_INTEGRITY_ERROR');
export function validateFileMutation(previous,next,newFiles=[],removeFiles=[],replace=false){
 if(!Array.isArray(newFiles)||!Array.isArray(removeFiles))throw problem('Invalid file changes');
 const old=new Map((previous.files||[]).map(f=>[f.id,f]));
 const wanted=new Map((next.files||[]).map(f=>[f.id,f]));
 if(old.size!==(previous.files||[]).length||wanted.size!==(next.files||[]).length)throw problem('Duplicate document IDs');
 const removed=new Set(removeFiles),uploaded=new Map(newFiles.map(x=>[x.id,x]));
 if(removed.size!==removeFiles.length)throw problem('Repeated document deletion');
 if(uploaded.size!==newFiles.length)throw problem('Repeated document upload');
 for(const id of removeFiles){
  if(!validId(id)||!old.has(id))throw problem('Deletion references unknown document');
  if(wanted.has(id)&&!replace)throw problem('Deletion cannot keep a document record while removing the original bytes');
 }
 if(!replace){
  for(const [id,meta] of old){
   if(!wanted.has(id)&&!removed.has(id))throw problem('Removed document must be explicitly deleted');
   const target=wanted.get(id);
   if(target){
    if(uploaded.has(id))throw problem('Use a new document ID for each revised original');
    for(const key of ['sha256','size','type'])if((meta[key]??'')!==(target[key]??''))throw problem('Original document bytes and content-type cannot change: upload a new revision');
   }
  }
 }
 for(const [id] of wanted){if((replace||!old.has(id))&&!uploaded.has(id))throw problem('New or replacement document has no verified original file');}
 for(const [id,x] of uploaded){
  if(!validId(id)||!validId(x.uploadId))throw problem('Invalid upload identifiers');
  if(!wanted.has(id))throw problem('Verified upload has no document entry');
  if(old.has(id)&&!replace)throw problem('Existing original cannot be overwritten');
 }
 return true;
}
