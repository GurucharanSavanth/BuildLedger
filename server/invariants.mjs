/* Checked on every versioned SQLite commit before altering any stored original. */
import {failure,validId} from './core.mjs';
import {validateFileChanges} from '../finance.js';
export function validateFileMutation(previous,next,newFiles=[],removeFiles=[],replace=false){
 try{
  validateFileChanges(previous,next,newFiles,removeFiles,replace);
  for(const file of newFiles)if(!validId(file.id)||!validId(file.uploadId))throw Error('Invalid upload identifiers');
  for(const id of removeFiles)if(!validId(id))throw Error('Deletion references unknown document');
  return true;
 }catch(error){throw failure(422,error.message,'FILE_INTEGRITY_ERROR')}
}
