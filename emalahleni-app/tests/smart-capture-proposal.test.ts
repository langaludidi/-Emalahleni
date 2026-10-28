import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeCaseForm,extractionProposalSchema,type ConfirmationInput} from '../src/smart-capture-proposal';
const applicant={firstNames:'Synthetic',surname:'Example',idNumber:'0000000000000',phone:null,maritalStatus:'SINGLE' as const,
 spouseName:null,disability:false,disaster:false,disasterDetails:null,propertyOwned:false,propertySold:false};
const data=():ConfirmationInput=>({proposal:{version:1 as const,applicant:{...applicant},household:{incomeSource:'UNEMPLOYED' as const,dependants:[]},
 extraFields:{},provenance:{},sections:[]},confirmedFields:['applicant.firstNames','applicant.surname','applicant.idNumber','applicant.maritalStatus',
 'applicant.disability','applicant.disaster','applicant.propertyOwned','applicant.propertySold','household.incomeSource'],confirmedUnknownBooleans:[]});
test('SC-005 review mapping never manufactures site findings',()=>{
 const r=proposeCaseForm(data());
 assert.deepEqual(r.blockingIssues,[]);
 assert.equal(r.form.applicant.firstNames,'Synthetic');
 assert.equal(r.form.site.verificationDate,'');
 assert.equal(r.form.site.latitude,null);
});
test('SC-005 unresolved applicant boolean never defaults silently to false',()=>{
 const p=data();p.proposal.applicant.disability=null;
 const r=proposeCaseForm(p);assert.ok(r.blockingIssues.includes('UNRESOLVED_BOOLEAN_disability'));
});
test('SC-005 third dependant is a blocker instead of silent truncation',()=>{
 const p=data();
 p.proposal.household.dependants=[{name:'a',relationship:'child'},{name:'b',relationship:'child'},{name:'c',relationship:'child'}];
 const r=proposeCaseForm(p);assert.ok(r.blockingIssues.includes('DEPENDANTS_EXCEED_SCHEMA_LIMIT'));
 assert.equal(r.form.household.dependants.length,0);
});
test('SC-005 invalid ID and conflicting pages require review',()=>{
 const p=data();p.proposal.applicant.idNumber='not id';
 p.proposal.provenance={'applicant.idNumber':{page:2,state:'CONFLICT' as const}};
 const r=proposeCaseForm(p);assert.ok(r.blockingIssues.includes('ID_FORMAT_INVALID'));assert.ok(r.blockingIssues.includes('SOURCE_CONFLICT_applicant.idNumber'));
});
test('SC-005 unconfirmed extracted values are not copied into case',()=>{
 const p=data();p.confirmedFields=[];
 const r=proposeCaseForm(p);assert.equal(r.form.applicant.firstNames,'');
 assert.ok(r.reviewIssues.includes('UNCONFIRMED_applicant.firstNames'));
});
test('SC-005 rejects unconstrained values and extra schema keys',()=>{
 const p=data();assert.equal(extractionProposalSchema.safeParse({...p.proposal,hacked:true}).success,false);
});
