/**
 * Conservative page-level document hints from Document AI OCR.
 * These are suggestions for the human reviewer, never verified evidence.
 */
import type {ExtractionProposal} from './smart-capture-proposal';

type Page={pageNumber?:number;layout?:{textAnchor?:{textSegments?:Array<{startIndex?:string|number;endIndex?:string|number}>}}}};
type Doc={text?:string;pages?:Page[]};
type Kind=ExtractionProposal['sections'][number]['type'];
const rules:ReadonlyArray<{kind:Kind;tokens:RegExp[]}>= [
 {kind:'APPLICANT_ID',tokens:[/\brepublic of south africa\b/i,/\bidentity (?:document|card|number)\b/i]},
 {kind:'BIRTH_CERT',tokens:[/\bbirth certificate\b/i,/\bdate of birth\b/i]},
 {kind:'MARRIAGE_CERT',tokens:[/\bmarriage certificate\b/i,/\bmarriage register\b/i]},
 {kind:'INCOME_PROOF',tokens:[/\bpayslip\b/i,/\bproof of (?:income|earnings)\b/i,/\bsalary advice\b/i]},
 {kind:'AFFIDAVIT',tokens:[/\baffidavit\b/i,/\bcommissioner of oaths\b/i]},
 {kind:'APPLICATION',tokens:[/\bhuman settlements\b/i,/\bhousing (?:subsidy|application)\b/i,/\bbeneficiary application\b/i]},
];
function textForPage(text:string,page:Page):string{
 const chars=Array.from(text),anchors=page.layout?.textAnchor?.textSegments;
 if(!Array.isArray(anchors))return '';
 return anchors.slice(0,30).map(a=>{
  const start=Number(a.startIndex??0),end=Number(a.endIndex??0);
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>=start&&end<=chars.length?
   chars.slice(start,end).join(''):'';
 }).join(' ').slice(0,16000);
}
export function classifyDocumentPages(document:Doc):ExtractionProposal['sections']{
 if(!document||typeof document.text!=='string'||!Array.isArray(document.pages))return [];
 const result:ExtractionProposal['sections']=[];
 // A malformed or reordered page number must not merge unrelated supporting
 // documents into a misleading page range. Treat its slot as unknown instead.
 for(let index=0;index<Math.min(200,document.pages.length);index++){
  const page=document.pages[index],number=index+1;
  const trustworthyNumber=page.pageNumber===undefined||page.pageNumber===number;
  if(!trustworthyNumber){
   result.push({type:'UNKNOWN',fromPage:number,toPage:number,status:'NOT_FOUND'});
   continue;
  }
  const text=textForPage(document.text,page).toLowerCase();
  const candidates=rules.map(rule=>({kind:rule.kind,score:rule.tokens.reduce((n,t)=>n+Number(t.test(text)),0)}))
   .filter(v=>v.score>0).sort((a,b)=>b.score-a.score);
  const winner=candidates[0];
  const certain=!!winner&&winner.score>=2&&(!candidates[1]||winner.score>candidates[1].score);
  const kind=winner?.kind??'UNKNOWN';
  const status:ExtractionProposal['sections'][number]['status']=certain?'DETECTED':winner?'UNCERTAIN':'NOT_FOUND';
  const previous=result[result.length-1];
  if(previous&&previous.type===kind&&previous.status===status&&previous.toPage+1===number){
   previous.toPage=number;
  }else result.push({type:kind,fromPage:number,toPage:number,status});
 }
 return result;
}
