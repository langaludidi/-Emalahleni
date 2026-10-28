import {Database} from './database';
import {decryptForm} from './crypto';
import {formSchema,type DepartmentReview} from './contracts';
import {evaluate} from './rules';
import {HttpError} from './http';
import {sha256Hex} from './hash';
import type {ExportSnapshot,PackEvidence} from './export-contracts';
export async function exportSnapshot(db:Database,actor:string,project:string,id:string,key:string):Promise<ExportSnapshot>{
 const [cases,evidence,reviews]=await db.forActor(actor,[
  {query:'SELECT id,reference,version,fields_ciphertext FROM public.applications WHERE project_id=$1 AND id=$2',params:[project,id]},
  {query:'SELECT id,kind,filename,content_type,sha256,status,malware_status,document_subtype,document_date,reviewed_by,reviewed_at,reviewed_form_version,certification_acknowledged,dependant_ordinal FROM public.evidence WHERE project_id=$1 AND application_id=$2 ORDER BY id',params:[project,id]},
  {query:`SELECT section,state,note,reviewed_by,reviewed_form_version,to_char(reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS reviewed_at FROM public.dohs_section_reviews WHERE project_id=$1 AND application_id=$2 ORDER BY section`,params:[project,id]}
 ],true);
 if(!cases.length)throw new HttpError(404,'NOT_FOUND');
 const form=formSchema.parse(await decryptForm(cases[0].fields_ciphertext,key,project,id));
 const generatedAt=new Date().toISOString();const readiness=evaluate(form,evidence as PackEvidence[],reviews as DepartmentReview[],generatedAt.slice(0,10),cases[0].version);
 const data={applicationId:id,projectId:project,reference:cases[0].reference,version:cases[0].version,form,readiness,evidence:evidence as PackEvidence[],reviews:reviews as ExportSnapshot['reviews']};
 const bytes=new TextEncoder().encode(JSON.stringify(data));const fingerprint=await sha256Hex(bytes);
 return {...data,generatedAt,fingerprint,preview:false};
}

