import test from 'node:test';
import assert from 'node:assert/strict';
import {compareIdReading} from '../src/evidence-consistency';
import type {IdReading} from '../src/id-reading';

const reading:IdReading={evidenceId:'synthetic-source',sha256:'a'.repeat(64),fields:{firstNames:'SYNTHETIC TEST',surname:'EXAMPLE',idNumber:'9001010000089'},dateOfBirth:null,warnings:[],requiresConfirmation:true};
test('ID consistency preserves provenance and distinguishes matches from discrepancies',()=>{
 const results=compareIdReading(reading,{firstNames:' synthetic   test ',surname:'DIFFERENT',idNumber:'9001010000089'});
 assert.deepEqual(results.map(result=>result.state),['MATCH','MISMATCH','MATCH']);
 assert.ok(results.every(result=>result.sourceEvidenceId==='synthetic-source'&&result.sourceSha256==='a'.repeat(64)&&result.requiresHumanReview));
});
test('missing values never count as matches or verified evidence',()=>{
 const results=compareIdReading({...reading,fields:{...reading.fields,firstNames:''}},{firstNames:'SYNTHETIC',surname:'',idNumber:''});
 assert.deepEqual(results.map(result=>result.state),['UNKNOWN','NOT_CHECKED','NOT_CHECKED']);
});
test('ID numbers are compared exactly rather than loosely normalized',()=>{
 const results=compareIdReading(reading,{...reading.fields,idNumber:'9001010000080'});
 assert.equal(results[2].state,'MISMATCH');
});
