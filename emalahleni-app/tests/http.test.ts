import test from 'node:test';
import assert from 'node:assert/strict';
import {blankForm} from '../src/contracts';
import {handle} from '../src/worker';

const url='https://app.example/api/preview';
test('bounded JSON reading preserves content-type, absent-body and invalid-JSON errors',async()=>{
  for(const [request,status,error] of [
    [new Request(url,{method:'POST'}),415,'JSON_REQUIRED'],
    [new Request(url,{method:'POST',headers:{'Content-Type':'application/json'}}),400,'BODY_REQUIRED'],
    [new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:''}),400,'INVALID_JSON'],
    [new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'}),400,'INVALID_JSON'],
  ] as const){
    const response=await handle(request,{});
    assert.equal(response.status,status);assert.deepEqual(await response.json(),{error});
  }
});
test('bounded JSON reading accepts exactly 32768 bytes and cancels an overflowing stream',async()=>{
  const body=JSON.stringify(blankForm());
  const padded=body+' '.repeat(32768-new TextEncoder().encode(body).length);
  const response=await handle(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:padded}),{});
  assert.equal(response.status,200);
  let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({
    start(controller){controller.enqueue(new Uint8Array(16384));controller.enqueue(new Uint8Array(16385));},
    cancel(){cancelled=true;},
  });
  const oversized=await handle(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'} as RequestInit),{});
  assert.equal(oversized.status,413);assert.deepEqual(await oversized.json(),{error:'BODY_TOO_LARGE'});assert.equal(cancelled,true);
});
