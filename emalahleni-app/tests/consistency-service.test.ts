import test from 'node:test';
import assert from 'node:assert/strict';
import {listIdConsistency,recordIdConsistency} from '../src/consistency-service';
import type {Database} from '../src/database';

test('listing consistency metadata keeps actor-scoped, read-only database access',async()=>{
 const calls:{actor:string;query:string;params:unknown[];readOnly:boolean}[]=[];
 const db={forActor:async(actor:string,statements:{query:string;params?:unknown[]}[],readOnly=false)=>{
  calls.push({actor,query:statements[0].query,params:statements[0].params??[],readOnly});
  return [[{evidence_id:'synthetic',state:'UNKNOWN',current:false}]];
 }} as unknown as Database;
 const result=await listIdConsistency(db,'test-actor','project-a','case-a');
 assert.equal(result.findings[0].current,false);
 assert.deepEqual(calls[0].params,['project-a','case-a']);
 assert.equal(calls[0].actor,'test-actor');
 assert.equal(calls[0].readOnly,true);
 assert.match(calls[0].query,/a\.version=f\.form_version/);
 assert.match(calls[0].query,/e\.malware_status='CLEAN'/);
});
test('consistency recording fails closed without encryption configuration',async()=>{
 const db={forActor:()=>{throw new Error('must not access database');}} as unknown as Database;
 await assert.rejects(recordIdConsistency(db,'actor','project','case','evidence',{}),{code:'CASE_API_NOT_CONFIGURED'});
});
