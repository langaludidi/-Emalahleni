import {z} from 'zod';

export const idFieldsSchema=z.object({
 firstNames:z.string().trim().max(250),surname:z.string().trim().max(250),
 idNumber:z.string().regex(/^$|^\d{13}$/)
}).strict();
export type IdFields=z.infer<typeof idFieldsSchema>;
export interface IdReading {
 evidenceId:string;sha256:string;fields:IdFields;dateOfBirth:string|null;
 warnings:string[];requiresConfirmation:true;
}

function calendarDate(year:number,month:number,day:number){
 const date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day
  ?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null;
}
export function birthDateFromId(value:string,today=new Date().toISOString().slice(0,10)){
 if(!/^\d{13}$/.test(value))return null;
 const year=Number(value.slice(0,2)),currentYear=Number(today.slice(0,4));
 const date=calendarDate((year<=currentYear%100?2000:1900)+year,Number(value.slice(2,4)),Number(value.slice(4,6)));
 return date&&date<=today?date:null;
}
export function validSaId(value:string,today?:string){
 if(!birthDateFromId(value,today)||!['0','1'].includes(value[10]))return false;
 let sum=0;
 for(let i=0;i<13;i++){let digit=Number(value[i]);if(i%2===1){digit*=2;if(digit>9)digit-=9;}sum+=digit;}
 return sum%10===0;
}

const nameLabels={
 firstNames:'(?:FIRST\\s*NAMES?|GIVEN\\s*NAMES?|FORENAMES?|NAMES?|VOORNAME)',
 surname:'(?:SURNAME|FAMILY\\s*NAME|VAN|SURNOM)'
};
const otherLabel=/^(?:SEX|GESLAG|NATIONALITY|NASIONALITEIT|IDENTITY|IDENTITEIT|ID\b|DATE|DATUM|COUNTRY|LAND|CITIZENSHIP|SIGNATURE|HANDTEKENING|PLACE|ISSUED|GEBOORTE|PERSOONLIKE|PERSONAL|REPUBLIC|REPUBLIEK|RSA\b)/i;
function nameValue(lines:string[],pattern:string){
 const matcher=new RegExp('^'+pattern+'(?:\\s*[/|]\\s*'+pattern+')?(?:(?:\\s*[:=]\\s*|\\s{2,})(.*))?$','iu');
 const inline=new RegExp('^'+pattern+'\\s*[:=]\\s*(.+)$','iu');
 const values=new Set<string>();
 for(let i=0;i<lines.length;i++){
  const match=lines[i].match(inline)??lines[i].match(matcher);if(!match)continue;
  const value=(match[1]?.trim()||lines[i+1]||'').trim().replace(/\s+/g,' ');
  if(value&&!otherLabel.test(value)&&!new RegExp('^(?:'+nameLabels.firstNames+'|'+nameLabels.surname+')\\s*:?$','iu').test(value)&&/^[\p{L}\p{M}][\p{L}\p{M}'’ -]{0,249}$/u.test(value))values.add(value);
 }
 return values.size===1?[...values][0]:'';
}
function printedBirthDate(lines:string[]){
 const index=lines.findIndex(line=>/^(?:DATE\s*OF\s*BIRTH|BIRTH\s*DATE|GEBOORTEDATUM)\b/i.test(line));
 if(index<0)return null;
 const value=(lines[index].replace(/^(?:DATE\s*OF\s*BIRTH|BIRTH\s*DATE|GEBOORTEDATUM)\s*:?\s*/i,'')||lines[index+1]||'').trim();
 let m=value.match(/^(\d{4})[-/ ](\d{1,2})[-/ ](\d{1,2})$/);if(m)return calendarDate(+m[1],+m[2],+m[3]);
 m=value.match(/^(\d{1,2})[-/ ](\d{1,2})[-/ ](\d{4})$/);if(m)return calendarDate(+m[3],+m[2],+m[1]);
 m=value.toUpperCase().match(/^(\d{1,2})[ -]+([A-Z]{3,9})[ -]+(\d{4})$/);
 if(m){const month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(m[2].slice(0,3))+1;return month?calendarDate(+m[3],month,+m[1]):null;}
 return null;
}
export function parseIdText(text:string,today=new Date().toISOString().slice(0,10)){
 // OCR text is untrusted data. Extract labelled values only; never execute or retain it.
 const lines=text.slice(0,16000).normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g,'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const warnings:string[]=[];
 const matches=lines.join('\n').match(/(?<![\dA-Za-z])\d(?:[ \t-]*\d){12}(?![ \t-]*\d|[A-Za-z])/g)??[];
 const numbers=[...new Set(matches.map(value=>value.replace(/\D/g,'')))];
 const valid=numbers.filter(value=>validSaId(value,today));
 const fields:IdFields={firstNames:nameValue(lines,nameLabels.firstNames),surname:nameValue(lines,nameLabels.surname),idNumber:valid.length===1?valid[0]:''};
 if(valid.length>1){return {fields:{firstNames:'',surname:'',idNumber:''},dateOfBirth:null,warnings:['More than one ID number was found. Use a copy containing only the applicant’s ID.']};}
 if(!fields.firstNames)warnings.push('First names could not be read unambiguously. Enter them from the ID.');
 if(!fields.surname)warnings.push('Surname could not be read unambiguously. Enter it from the ID.');
 if(!fields.idNumber)warnings.push(numbers.length?'The ID number did not pass the format, date and checksum checks. Enter it from the ID.':'No readable 13-digit South African ID number was found.');
 let dateOfBirth=fields.idNumber?birthDateFromId(fields.idNumber,today):null;
 const printed=printedBirthDate(lines);
 if(printed&&fields.idNumber){
  if(printed.slice(2).replaceAll('-','')===fields.idNumber.slice(0,6)&&printed<=today)dateOfBirth=printed;
  else{fields.idNumber='';dateOfBirth=null;warnings.push('The printed birth date and ID number disagree. Check the original ID and enter its number manually.');}
 }else if(dateOfBirth)warnings.push('The birth-date century was inferred from the ID number. Confirm it against the document.');
 warnings.push('Check every proposed value against the ID. Reading details does not verify identity or certify the document.');
 return {fields,dateOfBirth,warnings};
}
