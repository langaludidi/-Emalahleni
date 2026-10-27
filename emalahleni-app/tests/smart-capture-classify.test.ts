import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDocumentPages} from '../src/smart-capture-classify';
test('SC-011 groups consecutive pages with conservative supporting-document hints',()=>{
 const pages=['Affidavit sworn before commissioner of oaths','Affidavit sworn before commissioner of oaths',
  'Birth certificate, date of birth recorded','unclear handwriting'];
 let text='';const records=[];
 for(let i=0;i<pages.length;i++){const start=Array.from(text).length;text+=pages[i]+'\n';records.push({pageNumber:i+1,layout:{textAnchor:{textSegments:[{startIndex:String(start),endIndex:String(Array.from(text).length)}]}}});}
 const sections=classifyDocumentPages({text,pages:records});
 assert.deepEqual(sections,[
  {type:'AFFIDAVIT',fromPage:1,toPage:2,status:'DETECTED'},
  {type:'BIRTH_CERT',fromPage:3,toPage:3,status:'DETECTED'},
  {type:'UNKNOWN',fromPage:4,toPage:4,status:'NOT_FOUND'}
 ]);
});
test('SC-011 single weak keyword remains uncertain, not certified',()=>{
 const text='affidavit';assert.deepEqual(classifyDocumentPages({text,pages:[
  {pageNumber:1,layout:{textAnchor:{textSegments:[{startIndex:'0',endIndex:'9'}]}}}
 ]}),[{type:'AFFIDAVIT',fromPage:1,toPage:1,status:'UNCERTAIN'}]);
});
test('SC-011 no page text is never interpreted as a verified document',()=>{
 assert.deepEqual(classifyDocumentPages({text:'',pages:[{pageNumber:1}]}),
 [{type:'UNKNOWN',fromPage:1,toPage:1,status:'NOT_FOUND'}]);
});

test('SC-I04 inconsistent OCR page numbering fails closed rather than inventing evidence page ranges',()=>{
 const text='Affidavit commissioner of oaths Affidavit commissioner of oaths';
 const split='Affidavit commissioner of oaths'.length;
 const sections=classifyDocumentPages({text,pages:[
  {pageNumber:1,layout:{textAnchor:{textSegments:[{startIndex:0,endIndex:split}]}}},
  {pageNumber:1,layout:{textAnchor:{textSegments:[{startIndex:split,endIndex:text.length}]}}}
 ]});
 assert.deepEqual(sections,[
  {type:'AFFIDAVIT',fromPage:1,toPage:1,status:'DETECTED'},
  {type:'UNKNOWN',fromPage:2,toPage:2,status:'NOT_FOUND'}
 ]);
});
test('SC-I04 out-of-order page identifiers cannot be grouped into a false supporting document',()=>{
 const text='Birth certificate date of birth';
 assert.deepEqual(classifyDocumentPages({text,pages:[
  {pageNumber:2,layout:{textAnchor:{textSegments:[{startIndex:0,endIndex:text.length}]}}},
  {pageNumber:1,layout:{textAnchor:{textSegments:[{startIndex:0,endIndex:text.length}]}}}
 ]}),[
  {type:'UNKNOWN',fromPage:1,toPage:1,status:'NOT_FOUND'},
  {type:'UNKNOWN',fromPage:2,toPage:2,status:'NOT_FOUND'}
 ]);
});
