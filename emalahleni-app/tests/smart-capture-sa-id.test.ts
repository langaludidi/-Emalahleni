import test from 'node:test';
import assert from 'node:assert/strict';
import {validSouthAfricanIdChecksum,proposeCaseForm} from '../src/smart-capture-proposal';

test('Smart Capture SA identity check digit accepts synthetic valid values',()=>{
 assert.equal(validSouthAfricanIdChecksum('0000000000000'),true);
 assert.equal(validSouthAfricanIdChecksum('8001015009087'),true);
});
test('Smart Capture SA identity check digit rejects invalid and malformed values',()=>{
 assert.equal(validSouthAfricanIdChecksum('8001015009088'),false);
 assert.equal(validSouthAfricanIdChecksum('800101500908'),false);
 assert.equal(validSouthAfricanIdChecksum('800101500908x'),false);
});
test('Smart Capture never promotes a bad-checksum identity number into a draft',()=>{
 const proposal={
  version:1 as const,
  applicant:{firstNames:'Synthetic',surname:'Person',idNumber:'8001015009088',
   phone:null,maritalStatus:null,spouseName:null,disability:false,disaster:false,
   disasterDetails:null,propertyOwned:false,propertySold:false},
  household:{incomeSource:null,dependants:[]},
  extraFields:{},provenance:{},sections:[]
 };
 const result=proposeCaseForm({proposal,confirmedFields:['applicant.idNumber'],confirmedUnknownBooleans:[]});
 assert.ok(result.blockingIssues.includes('ID_CHECKSUM_INVALID'));
 assert.equal(result.form.applicant.idNumber,'');
});
