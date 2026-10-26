import {reviewCurrent} from './rules';
import type {CaseForm,Readiness} from './contracts';
export interface PackEvidence {id:string;kind:string;filename:string;content_type:string;sha256:string|null;status:string;malware_status:string;reviewed_by:string|null;reviewed_at:string|null;reviewed_form_version:number|null;document_date:string|null;document_subtype:string|null;certification_acknowledged:boolean;dependant_ordinal:number|null;}
export interface ExportSnapshot {applicationId:string;projectId:string;reference:string;version:number;form:CaseForm;readiness:Readiness;evidence:PackEvidence[];reviews:{section:string;state:string;note:string;reviewed_by:string;reviewed_at:string;reviewed_form_version:number|null}[];generatedAt:string;fingerprint:string;preview:boolean;}
export function packEvidence(evidence:PackEvidence[],formVersion:number){return evidence.filter(e=>reviewCurrent(e,formVersion)&&e.status==='VERIFIED'&&e.malware_status==='CLEAN'&&e.reviewed_by&&e.reviewed_at&&e.sha256);}

