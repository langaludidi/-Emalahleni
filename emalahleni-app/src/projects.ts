import {z} from 'zod';
import type {Database} from './database';
import {HttpError} from './http';

export const housingProjectSchema=z.object({
  id:z.uuid(),organisationId:z.uuid(),
  code:z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{2,39}$/,'Use 3–40 letters, numbers, hyphens or underscores, starting with a letter.'),
  name:z.string().trim().min(2).max(120),
  clientName:z.string().trim().max(160).default(''),
  location:z.string().trim().max(160).default(''),
}).strict();
export type HousingProjectInput=z.infer<typeof housingProjectSchema>;
export interface HousingProject {id:string;code:string;name:string;role:string;client_name?:string;location?:string;}
export interface ProjectOrganisation {id:string;name:string;}

export async function listProjects(db:Database,actor:string){
  const [projects,organisations]=await db.forActor(actor,[
    {query:'SELECT p.id,p.code,p.name,m.role FROM public.projects p JOIN public.project_memberships m ON m.project_id=p.id WHERE m.user_id=$1 AND m.active ORDER BY p.name',params:[actor]},
    {query:'SELECT id,name FROM public.project_creation_options()'},
  ],true);
  return {projects,projectCreation:{organisations}};
}
export async function createHousingProject(db:Database,actor:string,value:unknown){
  const input=housingProjectSchema.parse(value);
  try{
    const [rows]=await db.forActor(actor,[{
      query:'SELECT * FROM public.create_housing_project($1::uuid,$2::uuid,$3,$4,$5,$6)',
      params:[input.id,input.organisationId,input.code,input.name,input.clientName,input.location],
    }]);
    if(rows.length!==1)throw new HttpError(503,'PROJECT_CREATION_UNCONFIRMED');
    const {created,...project}=rows[0];return {project,created:created===true};
  }catch(error){
    const failure=error as {code?:string;message?:string};
    if(failure.code==='42501')throw new HttpError(403,'PROJECT_CREATION_DENIED');
    if(failure.code==='23505'&&failure.message==='PROJECT_CODE_EXISTS')throw new HttpError(409,'PROJECT_CODE_EXISTS');
    if(failure.message==='PROJECT_REQUEST_CONFLICT')throw new HttpError(409,'PROJECT_REQUEST_CONFLICT');
    if(failure.code==='22023'&&failure.message==='INVALID_PROJECT_DETAILS')throw new HttpError(400,'VALIDATION_FAILED');
    throw error;
  }
}
