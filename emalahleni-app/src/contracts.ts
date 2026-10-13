import { z } from 'zod';

export const incomeSources = ['UNEMPLOYED', 'SOCIAL_GRANT', 'EMPLOYED', 'SELF_EMPLOYED', 'PENSION', 'OTHER'] as const;
const text = z.string().trim().max(250);
const date = z.union([z.literal(''), z.iso.date()]);
export const formSchema = z.object({
  applicant: z.object({
    firstNames: text, surname: text, idNumber: z.string().regex(/^$|^\d{13}$/),
    phone: z.string().max(30), maritalStatus: z.enum(['', 'SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']),
    spouseName: text, disability: z.boolean(), disaster: z.boolean(),
    disasterDetails: z.string().max(1500), propertyOwned: z.boolean(), propertySold: z.boolean()
  }).strict(),
  household: z.object({ incomeSource: z.enum(['', ...incomeSources]), dependants: z.array(z.object({
    name: text, relationship: text
  }).strict()).max(2) }).strict(),
  site: z.object({ houseType: text, houseTypeConfirmed: z.boolean(),
    latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(),
    verificationDate: date, photoParametersConfirmed: z.boolean(),
    recommendation: z.string().max(1500), photoEvidenceId: z.union([z.literal(''), z.uuid()])
  }).strict()
}).strict();
export type CaseForm = z.infer<typeof formSchema>;
export function blankForm(): CaseForm {
  return { applicant: { firstNames: '', surname: '', idNumber: '', phone: '', maritalStatus: '', spouseName: '',
    disability: false, disaster: false, disasterDetails: '', propertyOwned: false, propertySold: false },
    household: { incomeSource: '', dependants: [] },
    site: { houseType: '', houseTypeConfirmed: false, latitude: null, longitude: null, verificationDate: '',
      photoParametersConfirmed: false, recommendation: '', photoEvidenceId: '' } };
}
export const dohsSections = ['PAGE_2', 'PAGE_3', 'SECTION_C', 'SECTION_E', 'SECTION_F', 'SECTION_H'] as const;
export interface Evidence {
  id: string; kind: string; status: string; malware_status: string;
  document_subtype: string | null; document_date: string | null;
  reviewed_by: string | null; reviewed_at: string | null;
  certification_acknowledged: boolean; dependant_ordinal: number | null;
}
export interface DepartmentReview { section: string; state: string; reviewed_by: string; reviewed_at: string; }
export interface Issue { code: string; message: string; owner: 'OUR_TEAM' | 'DOHS'; severity: 'BLOCKER' | 'REVIEW'; }
export interface Readiness {
  ruleVersion: string; provisional: true; readiness: 'RED' | 'AMBER' | 'GREEN';
  ourTeamReady: boolean; departmentalReady: boolean; submissionReady: false;
  issues: Issue[]; requirements: { kind: string; label: string }[];
}
