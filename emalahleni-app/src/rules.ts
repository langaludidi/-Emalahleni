import { CaseForm, Evidence, DepartmentReview, Readiness, Issue, dohsSections } from './contracts';

export const RULE_VERSION = 'emalahleni-recovered-conditional-v0.1';
export function requirementsFor(form: CaseForm) {
  const items = [
    { kind: 'APPLICANT_ID', label: 'Certified applicant ID copy' },
    { kind: 'APPLICANT_AFFIDAVIT', label: 'Signed and commissioned applicant affidavit' },
    { kind: 'BUILDING_AGREEMENT', label: 'Building agreement: applicant details and applicable signatures' },
    { kind: 'PROOF_OF_RESIDENCE', label: 'Proof of residence from an accepted authority' },
    { kind: 'SITE_PHOTO', label: 'Site photograph with confirmed GPS and capture date' }
  ];
  if (form.applicant.maritalStatus === 'MARRIED') items.push({ kind: 'SPOUSE_ID', label: 'Certified spouse ID and applicable building agreement signature' });
  if (form.applicant.disability) items.push({ kind: 'MEDICAL_CERTIFICATE', label: 'Disability medical certificate' });
  if (form.applicant.disaster) items.push({ kind: 'DISASTER_AFFIDAVIT', label: 'Signed and commissioned damage / disaster affidavit' });
  if (form.applicant.propertySold) items.push({ kind: 'DEED_OF_SALE', label: 'Deed of sale and applicable signatures' });
  if (form.household.incomeSource === 'UNEMPLOYED') items.push({ kind: 'UNEMPLOYMENT_AFFIDAVIT', label: 'Signed and commissioned no-income / unemployment affidavit' });
  else if (form.household.incomeSource) items.push({ kind: 'INCOME_PROOF', label: {
    SOCIAL_GRANT: 'SASSA letter, SASSA statement or bank statement showing grant payments',
    EMPLOYED: 'Payslip or employer confirmation', SELF_EMPLOYED: 'Business / self-employment income proof',
    PENSION: 'Pension payment proof', OTHER: 'Proof of the declared income source'
  }[form.household.incomeSource] });
  form.household.dependants.forEach((_, i) => items.push({ kind: `DEPENDANT_${i + 1}`, label: `Dependant ${i + 1}: ID copy or birth certificate` }));
  return items;
}

// Calendar months, clamped at month-end. SASSA-issued documents have no 3-month expiry.
export function threeMonthCutoff(today: string) {
  const d = new Date(today + 'T00:00:00Z');
  const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 3);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, end)); return d.toISOString().slice(0, 10);
}
function matches(e: Evidence, kind: string) {
  return kind.startsWith('DEPENDANT_') ? e.kind === 'DEPENDANT_ID_OR_BIRTH_CERT' && e.dependant_ordinal === Number(kind.slice(-1)) : e.kind === kind;
}
// An approval applies only to the saved form the reviewer actually checked.
export function reviewCurrent(review: {reviewed_form_version: number | null}, formVersion: number | null): boolean {
  return typeof formVersion === 'number' && Number.isInteger(formVersion) && formVersion >= 0 && review.reviewed_form_version === formVersion;
}
function verified(e: Evidence, today: string, formVersion: number | null): boolean {
  if (!reviewCurrent(e, formVersion)) return false;
  if (e.status !== 'VERIFIED' || e.malware_status !== 'CLEAN' || !e.reviewed_by || !e.reviewed_at) return false;
  if (['APPLICANT_ID', 'SPOUSE_ID'].includes(e.kind) && !e.certification_acknowledged) return false;
  const dated = e.kind.includes('AFFIDAVIT') || e.kind === 'PROOF_OF_RESIDENCE' || e.document_subtype === 'BANK_STATEMENT';
  if (e.document_date && e.document_date > today) return false;
  if (dated && (!e.document_date || e.document_date < threeMonthCutoff(today))) return false;
  return true;
}
function incomeMatches(e: Evidence, source: string) {
  if (source === 'SOCIAL_GRANT') return ['SASSA_LETTER', 'SASSA_STATEMENT', 'BANK_STATEMENT'].includes(e.document_subtype ?? '');
  if (source === 'EMPLOYED') return ['PAYSLIP', 'EMPLOYER_LETTER'].includes(e.document_subtype ?? '');
  return true; // Reviewer must verify the document against the declared source.
}
export function evaluate(form: CaseForm, evidence: Evidence[], reviews: DepartmentReview[], today: string, formVersion: number | null = null): Readiness {
  const issues: Issue[] = [];
  const add = (code: string, message: string, severity: Issue['severity'] = 'BLOCKER', owner: Issue['owner'] = 'OUR_TEAM') => issues.push({ code, message, owner, severity });
  if (!form.applicant.firstNames || !form.applicant.surname || !form.applicant.idNumber) add('APPLICANT_DETAILS', 'Complete applicant identity details.');
  if (!form.applicant.maritalStatus) add('MARITAL_STATUS', 'Confirm marital status.');
  if (form.applicant.maritalStatus === 'MARRIED' && !form.applicant.spouseName) add('SPOUSE_DETAILS', 'Complete spouse details.');
  if (!form.household.incomeSource) add('INCOME_SOURCE', 'Declare and confirm the income source.');
  if (form.household.dependants.some(d => !d.name || !d.relationship)) add('DEPENDANT_DETAILS', 'Complete the declared dependant details.');
  if (form.applicant.disaster && !form.applicant.disasterDetails) add('DISASTER_DETAILS', 'Describe the damage / disaster circumstances.');
  if (!form.site.houseType || !form.site.houseTypeConfirmed) add('HOUSE_TYPE', 'Confirm house type against the site photograph.');
  if (form.site.latitude === null || form.site.longitude === null || !form.site.verificationDate || !form.site.photoParametersConfirmed) add('PHOTO_PARAMETERS', 'Confirm photograph GPS coordinates and capture date.');
  if (form.site.verificationDate > today) add('FUTURE_VISIT', 'Verification date cannot be in the future.');
  if (!form.site.recommendation) add('RECOMMENDATION', 'Record the field recommendation supported by the photograph.');
  if(form.site.photoMetadataSource==='EXIF'&&!evidence.some(e=>e.id===form.site.photoEvidenceId&&e.kind==='SITE_PHOTO'&&e.sha256===form.site.photoMetadataSha256&&verified(e,today,formVersion)))add('PHOTO_METADATA_BINDING','Link the same verified photograph used for metadata extraction.');
  const requirements = requirementsFor(form);
  for (const requirement of requirements.filter(r => !r.kind.startsWith('DEPENDANT_'))) {
    const documents = evidence.filter(e => matches(e, requirement.kind));
    const accepted = documents.some(e => verified(e, today, formVersion) && (e.kind !== 'INCOME_PROOF' || incomeMatches(e, form.household.incomeSource)) && (e.kind !== 'SITE_PHOTO' || e.id === form.site.photoEvidenceId));
    if (!accepted) add(`EVIDENCE_${requirement.kind}`, documents.length ? `${requirement.label}: review against the current saved form, scan, certification or validity checks remain outstanding.` : `Provide ${requirement.label.toLowerCase()}.`);
  }
  const dependantCount = form.household.dependants.length;
  const acceptedDependants = new Set(evidence.filter(e => e.kind === 'DEPENDANT_ID_OR_BIRTH_CERT' && verified(e, today, formVersion) && e.dependant_ordinal !== null && e.dependant_ordinal <= dependantCount).map(e => e.dependant_ordinal));
  if (dependantCount === 2 && acceptedDependants.size === 1) add('DEPENDANT_POLICY_REVIEW', 'Two dependants with one verified document: obtain the second document or recorded DoHS policy confirmation.', 'REVIEW', 'DOHS');
  else if (acceptedDependants.size < dependantCount) add('DEPENDANT_EVIDENCE', 'Provide verified ID / birth evidence for each declared dependant.');
  if (form.applicant.propertyOwned || form.applicant.propertySold) add('PROPERTY_REVIEW', 'DoHS must review the declared property circumstances.', 'REVIEW', 'DOHS');
  for (const section of dohsSections) if (!reviews.some(r => r.section === section && r.state === 'COMPLETE' && r.reviewed_by && r.reviewed_at && reviewCurrent(r, formVersion))) add(`DOHS_${section}`, `${section.replaceAll('_', ' ')} awaits departmental completion against the current saved form.`, 'REVIEW', 'DOHS');
  add('RULES_PENDING_APPROVAL', 'The recovered conditional rules are provisional; source-workbook reconciliation and approval remain outstanding.', 'REVIEW', 'DOHS');
  const ourTeamReady = !issues.some(i => i.owner === 'OUR_TEAM');
  const departmentalReady = !issues.some(i => i.owner === 'DOHS');
  return { ruleVersion: RULE_VERSION, provisional: true, readiness: issues.some(i => i.severity === 'BLOCKER') ? 'RED' : 'AMBER', ourTeamReady, departmentalReady, submissionReady: false, issues, requirements };
}

