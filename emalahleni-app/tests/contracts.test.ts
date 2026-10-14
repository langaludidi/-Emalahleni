import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { actorFrom } from '../src/auth';
import { blankForm, formSchema, type Evidence } from '../src/contracts';
import { encryptForm, decryptForm } from '../src/crypto';
import { Database } from '../src/database';
import { evaluate, requirementsFor, threeMonthCutoff } from '../src/rules';
import { handle } from '../src/worker';

const today='2026-10-10';
function form() { const f=blankForm();f.applicant={...f.applicant,firstNames:'Synthetic',surname:'Example',idNumber:'0000000000000',maritalStatus:'SINGLE'};f.household.incomeSource='UNEMPLOYED';f.site={houseType:'Mud structure',houseTypeConfirmed:true,latitude:-31.7,longitude:27.3,verificationDate:today,photoParametersConfirmed:true,recommendation:'Synthetic observation',photoEvidenceId:'00000000-0000-4000-8000-000000000010',photoMetadataSha256:'',photoMetadataSource:''};return f; }
function evidence(f= form()):Evidence[] {return requirementsFor(f).map((r,i)=>({id:r.kind==='SITE_PHOTO'?f.site.photoEvidenceId:`00000000-0000-4000-8000-${String(i+100).padStart(12,'0')}`,kind:r.kind,status:'VERIFIED',malware_status:'CLEAN',document_subtype:r.kind.includes('AFFIDAVIT')?'AFFIDAVIT':null,document_date:today,reviewed_by:'synthetic-assessor',reviewed_at:today,certification_acknowledged:true,dependant_ordinal:null}));}
test('conditional declarations require evidence; client cannot set departmental or document approval',()=>{
 const f=form();f.applicant.disability=true;f.applicant.maritalStatus='MARRIED';f.applicant.disaster=true;
 const kinds=requirementsFor(f).map(r=>r.kind);
 for(const k of ['UNEMPLOYMENT_AFFIDAVIT','SPOUSE_ID','MEDICAL_CERTIFICATE','DISASTER_AFFIDAVIT'])assert.ok(kinds.includes(k));
 assert.equal(formSchema.safeParse({...f,dohs_complete:true}).success,false);
 assert.equal(formSchema.safeParse({...f,evidence:[{status:'VERIFIED'}]}).success,false);
 f.household.dependants=[{name:'a',relationship:'child'},{name:'b',relationship:'child'},{name:'c',relationship:'child'}];assert.equal(formSchema.safeParse(f).success,false);
});
test('pending scan, missing reviewer and unreviewed evidence cannot pass readiness',()=>{
 const f=form();const docs=evidence(f);assert.equal(evaluate(f,docs,[],today).ourTeamReady,true);
 for(const change of [{malware_status:'NOT_SCANNED'},{status:'PENDING_REVIEW'},{reviewed_by:null},{certification_acknowledged:false}]){
  const changed=docs.map(d=>d.kind==='APPLICANT_ID'?{...d,...change}:d);assert.equal(evaluate(f,changed,[],today).ourTeamReady,false);
 }
 assert.equal(evaluate(f,docs,[],today).submissionReady,false);
});
test('calendar month boundaries and SASSA-specific validity',()=>{
 assert.equal(threeMonthCutoff('2026-05-31'),'2026-02-28');assert.equal(threeMonthCutoff('2024-05-31'),'2024-02-29');
 const f=form();f.household.incomeSource='SOCIAL_GRANT';let docs=evidence(f);
 docs=docs.map(d=>d.kind==='INCOME_PROOF'?{...d,document_subtype:'SASSA_LETTER',document_date:'2020-01-01'}:d);
 assert.equal(evaluate(f,docs,[],today).ourTeamReady,true);
 const bank=docs.map(d=>d.kind==='INCOME_PROOF'?{...d,document_subtype:'BANK_STATEMENT'}:d);
 assert.equal(evaluate(f,bank,[],today).ourTeamReady,false);
 const boundary=bank.map(d=>d.kind==='INCOME_PROOF'?{...d,document_date:'2026-07-10'}:d);
 assert.equal(evaluate(f,boundary,[],today).ourTeamReady,true);
});
test('two dependants with one document receive policy review; one ordinal cannot count twice',()=>{
 const f=form();f.household.dependants=[{name:'a',relationship:'child'},{name:'b',relationship:'child'}];
 const docs=evidence(f).filter(d=>!d.kind.startsWith('DEPENDANT_'));
 const d={...evidence()[0],kind:'DEPENDANT_ID_OR_BIRTH_CERT',dependant_ordinal:1};
 const r=evaluate(f,[...docs,d,{...d,id:'duplicate'}],[],today);
 assert.equal(r.readiness,'AMBER');assert.ok(r.issues.some(i=>i.code==='DEPENDANT_POLICY_REVIEW'&&i.owner==='DOHS'));
});
test('encrypted draft cannot be moved to another case or altered',async()=>{
 const key=Buffer.alloc(32,7).toString('base64');const encoded=await encryptForm(form(),key,'project-a','case-a');
 assert.equal(encoded.includes('Synthetic'),false);assert.deepEqual(await decryptForm(encoded,key,'project-a','case-a'),form());
 await assert.rejects(decryptForm(encoded,key,'project-b','case-a'));await assert.rejects(decryptForm(encoded,key,'project-a','case-b'));
 await assert.rejects(decryptForm(encoded,key.replace(/^./,'A'),'project-a','case-a'));
});
test('JWT verification rejects wrong issuer, expired, unsigned and anonymous tokens',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('EdDSA');const jwk=await exportJWK(publicKey);jwk.kid='test';
 const key=createLocalJWKSet({keys:[jwk]});const config={NEON_AUTH_BASE_URL:'https://auth.example/neondb/auth',NEON_AUTH_JWKS_URL:'https://auth.example/jwks'};
 async function token(issuer='https://auth.example',expiry='15m',anonymous=false){return new SignJWT({isAnonymous:anonymous}).setProtectedHeader({alg:'EdDSA',kid:'test'}).setSubject('actor-a').setIssuedAt().setIssuer(issuer).setExpirationTime(expiry).sign(privateKey)}
 const request=(value:string)=>new Request('https://app.example/api/projects',{headers:{Authorization:`Bearer ${value}`}});
 assert.equal(await actorFrom(request(await token()),config,key),'actor-a');
 await assert.rejects(actorFrom(request(await token('https://other.example')),config,key));
 await assert.rejects(actorFrom(request(await token(undefined,'-10m')),config,key));
 await assert.rejects(actorFrom(request(await token(undefined,undefined,true)),config,key));
 await assert.rejects(actorFrom(request('eyJhbGciOiJub25lIn0.e30.'),config,key));
});
test('database adapter refuses owner credentials',()=>{
 assert.throws(()=>new Database('postgresql://neondb_owner:secret@a.neon.tech/neondb?sslmode=require'));
 assert.throws(()=>new Database('postgresql://emalahleni_worker:secret@other.example/neondb?sslmode=require'));
});
test('unconfigured case API fails closed; preview rejects forged evidence and oversized bodies',async()=>{
 assert.equal((await handle(new Request('https://app.example/api/projects'),{})).status,503);
 const preview=(data:unknown)=>new Request('https://app.example/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 assert.equal((await handle(preview({...form(),evidence:[{status:'VERIFIED'}]}),{})).status,400);
 assert.equal((await handle(preview({padding:'x'.repeat(40000)}),{})).status,413);
 assert.equal((await handle(new Request('https://app.example/storage-probe',{method:'PUT'}),{})).status,405);
});
test('R2 probe uses only its fixed synthetic key and redacts backend failures',async()=>{
 const keys:string[]=[];
 const env:any={EVIDENCE_BUCKET:{head:async(k:string)=>{keys.push(k);return null}}};
 const response=await handle(new Request('https://app.example/storage-probe?key=beneficiary/id'),env);
 assert.equal(response.status,200);assert.deepEqual(keys,['__preflight__/synthetic-probe']);
 const failed=await handle(new Request('https://app.example/storage-probe'),{EVIDENCE_BUCKET:{head:async()=>{throw new Error('PRIVATE')}} as any});
 assert.equal(failed.status,503);assert.equal((await failed.text()).includes('PRIVATE'),false);
});
