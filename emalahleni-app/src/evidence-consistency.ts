import type {IdFields,IdReading} from './id-reading';

export type ConsistencyState='MATCH'|'MISMATCH'|'UNKNOWN'|'NOT_CHECKED';
export interface ConsistencyFinding {
 field:keyof IdFields;
 state:ConsistencyState;
 sourceEvidenceId:string;
 sourceSha256:string;
 extractionMethod:'SCANNER_OCR_LABELLED_ID_V1';
 requiresHumanReview:true;
}

// This comparison is advisory. It never verifies identity, accepts evidence,
// changes the case, or writes extracted personal information to an audit log.
export function compareIdReading(reading:IdReading,current:IdFields):ConsistencyFinding[]{
 const fields:(keyof IdFields)[]=['firstNames','surname','idNumber'];
 return fields.map(field=>{
  const extracted=reading.fields[field].normalize('NFKC').trim();
  const recorded=current[field].normalize('NFKC').trim();
  const state:ConsistencyState=!extracted?'UNKNOWN':!recorded?'NOT_CHECKED':
   (field==='idNumber'?extracted===recorded:extracted.replace(/\s+/g,' ').toLocaleUpperCase('en-ZA')===recorded.replace(/\s+/g,' ').toLocaleUpperCase('en-ZA'))?'MATCH':'MISMATCH';
  return {field,state,sourceEvidenceId:reading.evidenceId,sourceSha256:reading.sha256,
   extractionMethod:'SCANNER_OCR_LABELLED_ID_V1',requiresHumanReview:true};
 });
}
