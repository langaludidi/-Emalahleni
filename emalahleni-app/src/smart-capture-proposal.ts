/**
 * Smart Capture extraction proposal -> existing strict case form.
 * No provider data is trusted or silently promoted to an approved draft.
 */
import {z} from 'zod';
import {blankForm,formSchema,type CaseForm} from './contracts';

const fieldState=z.enum(['EXTRACTED','UNREADABLE','MISSING','CONFLICT','CONFIRMED']);
const evidence=z.object({
 page:z.number().int().min(1).max(2000),
 rawText:z.string().max(3000).optional(),
 state:fieldState,
}).strict();
export const extractedApplicant=z.object({
 firstNames:z.string().max(250).nullable(),
 surname:z.string().max(250).nullable(),
 idNumber:z.string().nullable(),
 phone:z.string().max(30).nullable(),
 maritalStatus:z.enum(['SINGLE','MARRIED','DIVORCED','WIDOWED']).nullable(),
 spouseName:z.string().max(250).nullable(),
 disability:z.boolean().nullable(),
 disaster:z.boolean().nullable(),
 disasterDetails:z.string().max(1500).nullable(),
 propertyOwned:z.boolean().nullable(),
 propertySold:z.boolean().nullable(),
}).strict();
export const extractedHousehold=z.object({
 incomeSource:z.enum(['UNEMPLOYED','SOCIAL_GRANT','EMPLOYED','SELF_EMPLOYED','PENSION','OTHER']).nullable(),
 dependants:z.array(z.object({name:z.string().max(250),relationship:z.string().max(250)}).strict()).max(30),
}).strict();
export const extractionProposalSchema=z.object({
 version:z.literal(1),
 applicant:extractedApplicant,
 household:extractedHousehold,
 // Non-capture fields remain in encrypted proposal, not shoehorned into site fields.
 extraFields:z.record(z.string().max(90),z.string().max(2000)).default({}),
 provenance:z.record(z.string(),evidence).default({}),
 sections:z.array(z.object({
  type:z.enum(['APPLICATION','APPLICANT_ID','SPOUSE_ID','INCOME_PROOF','BIRTH_CERT',
    'MARRIAGE_CERT','AFFIDAVIT','OTHER','UNKNOWN']),
  fromPage:z.number().int().min(1),toPage:z.number().int().min(1),
  status:z.enum(['DETECTED','UNCERTAIN','NOT_FOUND'])
 }).strict()).max(200).default([]),
}).strict();
export type ExtractionProposal=z.infer<typeof extractionProposalSchema>;
export const confirmationSchema=z.object({
 proposal:extractionProposalSchema,
 // Explicit field approval must accompany each applicable ambiguous boolean.
 confirmedUnknownBooleans:z.array(z.enum(['disability','disaster','propertyOwned','propertySold'])).default([]),
 confirmedFields:z.array(z.string()).max(100),
}).strict();
export type ConfirmationInput=z.input<typeof confirmationSchema>;
export type ConfirmationResult={form:CaseForm;blockingIssues:string[];reviewIssues:string[]};
export function proposeCaseForm(input:unknown):ConfirmationResult{
 const data=confirmationSchema.parse(input);
 const p=data.proposal,form=blankForm(),blockingIssues:string[]=[],reviewIssues:string[]=[];
 const confirmed=new Set(data.confirmedFields);
 const boolConfirmed=new Set(data.confirmedUnknownBooleans);
 const assign=(key:keyof CaseForm['applicant'],value:unknown)=>{
  if(typeof value==='string'){
   if(value&&confirmed.has('applicant.'+key)) (form.applicant as unknown as Record<string,unknown>)[key]=value;
   else if(value)reviewIssues.push('UNCONFIRMED_applicant.'+key);
  }
 };
 assign('firstNames',p.applicant.firstNames);assign('surname',p.applicant.surname);
 assign('phone',p.applicant.phone);assign('spouseName',p.applicant.spouseName);
 assign('disasterDetails',p.applicant.disasterDetails);
 const id=p.applicant.idNumber;
 if(id!==null){
  if(!/^\d{13}$/.test(id))blockingIssues.push('ID_FORMAT_INVALID');
  else if(confirmed.has('applicant.idNumber'))form.applicant.idNumber=id;
  else reviewIssues.push('UNCONFIRMED_applicant.idNumber');
 }
 if(p.applicant.maritalStatus){
  if(confirmed.has('applicant.maritalStatus'))form.applicant.maritalStatus=p.applicant.maritalStatus;
  else reviewIssues.push('UNCONFIRMED_applicant.maritalStatus');
 }
 for(const key of ['disability','disaster','propertyOwned','propertySold'] as const){
  const value=p.applicant[key];
  if(value===null && !boolConfirmed.has(key))blockingIssues.push('UNRESOLVED_BOOLEAN_'+key);
  else if(value!==null && confirmed.has('applicant.'+key))form.applicant[key]=value;
  else if(value!==null)reviewIssues.push('UNCONFIRMED_applicant.'+key);
  // A reviewer must explicitly choose the answer if OCR could not read it:
  // this function does not fill unknowns with invented answers.
  if(value===null && boolConfirmed.has(key))blockingIssues.push('MISSING_EXPLICIT_VALUE_'+key);
 }
 if(p.household.incomeSource){
  if(confirmed.has('household.incomeSource'))form.household.incomeSource=p.household.incomeSource;
  else reviewIssues.push('UNCONFIRMED_household.incomeSource');
 }
 if(p.household.dependants.length>2)blockingIssues.push('DEPENDANTS_EXCEED_SCHEMA_LIMIT');
 else if(p.household.dependants.length){
  if(confirmed.has('household.dependants'))form.household.dependants=p.household.dependants;
  else reviewIssues.push('UNCONFIRMED_household.dependants');
 }
 if(Object.keys(p.extraFields).length)reviewIssues.push('SOURCE_FIELDS_OUTSIDE_CURRENT_FORM');
 for(const [key,source] of Object.entries(p.provenance)){
  if(source.state==='UNREADABLE'||source.state==='CONFLICT')blockingIssues.push('SOURCE_'+source.state+'_'+key);
 }
 if(!formSchema.safeParse(form).success)blockingIssues.push('FORM_SCHEMA_MISMATCH');
 return {form,blockingIssues,reviewIssues};
}
