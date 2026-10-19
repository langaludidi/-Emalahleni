// Reproducible fictional-only data for the isolated Vectra Assure dashboard preview.
// Never use for real beneficiary records, staging, production or the capture service.
// Required: PREVIEW_OWNER_DATABASE_URL, FORM_ENCRYPTION_KEY and --apply.
// URL guard intentionally requires the owner role and exact standalone database name.
// Do not print, commit, or transmit encryption secrets.
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { neon } from '@neondatabase/serverless';

const org='11111111-1111-4111-8111-111111111111';
const projects=[
  {id:'22222222-2222-4222-8222-222222222221',code:'SYNTHETIC-ALPHA',name:'Fictional Housing Project Alpha'},
  {id:'22222222-2222-4222-8222-222222222222',code:'SYNTHETIC-BETA',name:'Fictional Housing Project Beta'}
];
const identities=[
  {id:'synthetic:test:alpha-manager',name:'Fictional Alpha Manager'},
  {id:'synthetic:test:beta-auditor',name:'Fictional Beta Auditor'},
  {id:'synthetic:test:no-project',name:'Fictional Unassigned User'}
];
const cases=[
  {id:'33333333-3333-4333-8333-000000000001',project:projects[0].id,reference:'SYNTH-A-001',status:'DRAFT'},
  {id:'33333333-3333-4333-8333-000000000002',project:projects[0].id,reference:'SYNTH-A-002',status:'RETURNED'},
  {id:'33333333-3333-4333-8333-000000000003',project:projects[0].id,reference:'SYNTH-A-003',status:'ASSESSMENT_COMPLETE'},
  {id:'33333333-3333-4333-8333-000000000004',project:projects[1].id,reference:'SYNTH-B-004',status:'DRAFT'},
  {id:'33333333-3333-4333-8333-000000000005',project:projects[1].id,reference:'SYNTH-B-005',status:'RETURNED'}
];
function demoForm(index){
  return {
    applicant:{firstNames:'Fictional',surname:'Demo'+index,idNumber:'',phone:'',maritalStatus:'',spouseName:'',
      disability:false,disaster:false,disasterDetails:'',propertyOwned:false,propertySold:false},
    household:{incomeSource:'',dependants:[]},
    site:{houseType:'',houseTypeConfirmed:false,latitude:null,longitude:null,verificationDate:'',
      photoParametersConfirmed:false,recommendation:'',photoEvidenceId:'',photoMetadataSha256:'',photoMetadataSource:''}
  };
}
async function main(){
  if (!process.argv.includes('--apply')) {
    console.log('Dry run. Five encrypted, fictional cases across two projects. Add --apply with preview-only credentials to seed.');
    return;
  }
  const uri=process.env.PREVIEW_OWNER_DATABASE_URL;
  const key=process.env.FORM_ENCRYPTION_KEY;
  if (!uri || !key) throw new Error('PREVIEW_SECRET_MISSING');
  const url=new URL(uri);
  if (url.username!=='vectra_preview_owner' || url.pathname!=='/vectra_preview' ||
      !url.hostname.endsWith('.neon.tech') || url.searchParams.get('sslmode')!=='require')
    throw new Error('NOT_ISOLATED_PREVIEW_DATABASE');
  const bytes=Buffer.from(key,'base64');
  if (bytes.length!==32) throw new Error('INVALID_PREVIEW_KEY');
  const cryptoKey=await webcrypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt']);
  const encrypted=await Promise.all(cases.map(async (item,i)=>{
    const iv=webcrypto.getRandomValues(new Uint8Array(12));
    const context=new TextEncoder().encode(`emalahleni:v1:${item.project}:${item.id}`);
    const encoded=new TextEncoder().encode(JSON.stringify(demoForm(i+1)));
    const ct=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context},cryptoKey,encoded);
    return `v1.${Buffer.from(iv).toString('base64')}.${Buffer.from(ct).toString('base64')}`;
  }));
  const db=neon(uri);
  const statements=[
    db.query('INSERT INTO public.organisations (id,name,type) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING',
      [org,'FICTIONAL Vectra Preview Organisation','DEMO']),
    ...identities.map(u=>db.query('INSERT INTO public.users (id,display_name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING',[u.id,u.name])),
    ...projects.map(p=>db.query('INSERT INTO public.projects (id,organisation_id,code,name) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',[p.id,org,p.code,p.name])),
    db.query('INSERT INTO public.project_memberships (project_id,user_id,role,active) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING',
      [projects[0].id,identities[0].id,'MANAGER']),
    db.query('INSERT INTO public.project_memberships (project_id,user_id,role,active) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING',
      [projects[1].id,identities[1].id,'AUDITOR']),
    ...cases.map((c,i)=>db.query(
      'INSERT INTO public.applications (id,organisation_id,project_id,reference,fields_ciphertext,workflow_status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
      [c.id,org,c.project,c.reference,encrypted[i],c.status]))
  ];
  await db.transaction(statements,{isolationLevel:'Serializable'});
  console.log('Preview fictional fixture seed committed: two projects, three test identities, five encrypted applications.');
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
