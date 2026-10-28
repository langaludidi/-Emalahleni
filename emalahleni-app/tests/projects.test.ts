import test from 'node:test';
import assert from 'node:assert/strict';
import type {Database,Statement} from '../src/database';
import {housingProjectSchema,createHousingProject,listProjects} from '../src/projects';
import {createHandler} from '../src/worker';

const input={id:'40000000-0000-4000-8000-000000000001',organisationId:'10000000-0000-4000-8000-000000000001',code:' syn-new ',name:' Synthetic housing ',clientName:' Synthetic authority ',location:' Test location '};
test('housing project input normalises text and rejects invalid codes, oversized names and caller-selected roles',()=>{
  assert.deepEqual(housingProjectSchema.parse(input),{...input,code:'SYN-NEW',name:'Synthetic housing',clientName:'Synthetic authority',location:'Test location'});
  for(const patch of [{code:'A'},{code:'1BAD'},{code:'BAD CODE'},{name:' '},{name:'x'.repeat(121)},{role:'ADMIN'},{organisationId:'not-a-uuid'},{location:'x'.repeat(161)}])assert.equal(housingProjectSchema.safeParse({...input,...patch}).success,false);
});
test('project listing keeps actor context and creation options in a read-only transaction',async()=>{
  const db={forActor:async(actor:string,statements:Statement[],readOnly:boolean)=>{
    assert.equal(actor,'synthetic-creator');assert.equal(readOnly,true);assert.equal(statements.length,2);
    assert.deepEqual(statements[0].params,['synthetic-creator']);
    return [[{id:'project',role:'OFFICER'}],[{id:input.organisationId,name:'Synthetic organisation'}]];
  }} as unknown as Database;
  assert.deepEqual(await listProjects(db,'synthetic-creator'),{projects:[{id:'project',role:'OFFICER'}],projectCreation:{organisations:[{id:input.organisationId,name:'Synthetic organisation'}]}});
});
test('project creation delegates the atomic grant to the database and distinguishes an idempotent replay',async()=>{
  for(const created of [true,false]){
    const db={forActor:async(actor:string,statements:Statement[])=>{
      assert.equal(actor,'synthetic-creator');assert.equal(statements.length,1);
      assert.deepEqual(statements[0].params,[input.id,input.organisationId,'SYN-NEW','Synthetic housing','Synthetic authority','Test location']);
      return [[{id:input.id,name:'Synthetic housing',code:'SYN-NEW',role:'ADMIN',created}]];
    }} as unknown as Database;
    assert.equal((await createHousingProject(db,'synthetic-creator',input)).created,created);
  }
});
test('creation rejects unauthorised, duplicate-code and changed-request failures with fixed API errors',async()=>{
  for(const [code,message,status] of [['42501','PROJECT_CREATION_DENIED',403],['23505','PROJECT_CODE_EXISTS',409],['P0001','PROJECT_REQUEST_CONFLICT',409],['22023','INVALID_PROJECT_DETAILS',400]] as const){
    const db={forActor:async()=>{throw Object.assign(new Error(message),{code});}} as unknown as Database;
    await assert.rejects(createHousingProject(db,'synthetic-creator',input),(error:any)=>error.status===status);
  }
});
test('project creation requires API authentication and preserves private response headers',async()=>{
  const app=createHandler(async()=>{throw Error('no session');});
  const response=await app(new Request('https://app.example/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),{ENABLE_CASE_API:'true',DATABASE_URL:'configured',FORM_ENCRYPTION_KEY:'configured'});
  assert.equal(response.status,401);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
