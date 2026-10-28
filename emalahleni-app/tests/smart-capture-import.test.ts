import test from 'node:test';
import assert from 'node:assert/strict';
import {canTransition,discoveryVersion,sourceIdentity,publicImportSummary} from '../src/smart-capture-import';
import type { DrivePdf } from '../src/smart-capture-drive';
const synthetic:DrivePdf={providerFileId:'syntheticFile_12345',name:'Synthetic.pdf',
 mimeType:'application/pdf',sizeBytes:120000,modifiedTime:'2026-10-27T12:00:00.000Z',
 revision:'6',checksum:'a'.repeat(32)};

test('SC-003 unchanged PDF yields stable project/source/version identity',()=>{
 const a=sourceIdentity('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',synthetic);
 assert.deepEqual(a,sourceIdentity(a.projectId,a.sourceId,{...synthetic}));
 assert.notDeepEqual(a,sourceIdentity(a.projectId,a.sourceId,{...synthetic,revision:'7'}));
 assert.notDeepEqual(a,sourceIdentity(a.projectId,'00000000-0000-4000-8000-000000000003',synthetic));
});
test('SC-003 no guessed revision without stable provider metadata',()=>{
 assert.equal(discoveryVersion(synthetic),'v:6');
 assert.match(discoveryVersion({...synthetic,revision:null}),/^m:.*:a{32}$/);
 assert.throws(()=>discoveryVersion({...synthetic,revision:null,checksum:null}),/SOURCE_REVISION_UNAVAILABLE/);
});
test('SC-003 denies all skipping of screening, extraction and review',()=>{
 assert.equal(canTransition('DISCOVERED','QUEUED'),true);
 assert.equal(canTransition('DISCOVERED','COMMITTED'),false);
 assert.equal(canTransition('QUEUED','COMMITTED'),false);
 assert.equal(canTransition('SCANNING','COMMITTED'),false);
 assert.equal(canTransition('EXTRACTING','VERIFIED'),false);
 assert.equal(canTransition('NEEDS_REVIEW','VERIFIED'),true);
 assert.equal(canTransition('VERIFIED','COMMITTING'),true);
 assert.equal(canTransition('COMMITTING','COMMIT_UNCERTAIN'),true);
 assert.equal(canTransition('COMMIT_UNCERTAIN','COMMITTING'),false);
 assert.equal(canTransition('COMMITTED','QUEUED'),false);
});
test('SC-003 list summaries exclude source IDs, hashes and sensitive metadata',()=>{
 const r=publicImportSummary({id:'synthetic',projectId:'private-project',state:'NEEDS_REVIEW',
  applicationId:null,attemptCount:0,errorCode:null});
 assert.deepEqual(r,{id:'synthetic',state:'NEEDS_REVIEW',applicationId:null,attemptCount:0,errorCode:null});
});
