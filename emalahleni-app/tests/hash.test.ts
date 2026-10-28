import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sha256Hex} from '../src/hash';
import {digest} from '../src/evidence';
import {limitPublicApi} from '../src/rate-limit';

test('shared SHA-256 matches published vectors for browser buffers and Worker byte arrays',async()=>{
  assert.equal(await sha256Hex(new ArrayBuffer(0)),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const bytes=new TextEncoder().encode('abc');
  const expected='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(await sha256Hex(bytes),expected);
  assert.equal(await sha256Hex(bytes.buffer),expected);
  assert.equal(await digest(bytes),expected);
});
test('document hashing excludes bytes outside a typed-array view',async()=>{
  const bytes=new TextEncoder().encode('prefix:abc:suffix').subarray(7,10);
  const expected='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(await sha256Hex(bytes),expected);
  assert.equal(await digest(bytes),expected);
});
test('quota key encoding remains identical to the native SHA-256 preimage',async()=>{
  const keys:string[]=[];
  await limitPublicApi(new Request('https://app.example/api/projects', {headers:{'CF-Connecting-IP':'2001:db8::1'}}),{
    ENABLE_API_RATE_LIMITS:'true',
    API_RATE_LIMITER:{limit:async({key})=>{keys.push(key);return {success:true};}},
  });
  assert.deepEqual(keys,[createHash('sha256').update('emalahleni-api-staging:api:2001:db8::1').digest('hex')]);
  const unicode=new TextEncoder().encode(JSON.stringify({name:'Synthetic — café',version:3,items:[null,true,1]}));
  assert.equal(await sha256Hex(unicode),createHash('sha256').update(unicode).digest('hex'));
});
