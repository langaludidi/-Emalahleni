import type {CaseForm} from '../../src/contracts';
import Field from './form-field';

type Applicant = CaseForm['applicant'];
type Props = {
  applicant: Applicant;
  onChange: <K extends keyof Applicant>(key: K, value: Applicant[K]) => void;
};

export default function ApplicantFields({applicant, onChange}: Props) {
  return <>
    <p className="hint">Applicant information belongs to our team. Departmental eligibility decisions remain with DoHS.</p>
    <div className="grid">
      <Field label="First names"><input value={applicant.firstNames} onChange={event => onChange('firstNames', event.target.value)}/></Field>
      <Field label="Surname"><input value={applicant.surname} onChange={event => onChange('surname', event.target.value)}/></Field>
      <Field label="South African ID number"><input inputMode="numeric" maxLength={13} value={applicant.idNumber} onChange={event => onChange('idNumber', event.target.value.replace(/\D/g, ''))}/></Field>
      <Field label="Contact number"><input type="tel" value={applicant.phone} onChange={event => onChange('phone', event.target.value)}/></Field>
      <Field label="Marital status">
        <select value={applicant.maritalStatus} onChange={event => onChange('maritalStatus', event.target.value as Applicant['maritalStatus'])}>
          <option value="">Choose status</option>
          <option value="SINGLE">Single</option>
          <option value="MARRIED">Married</option>
          <option value="DIVORCED">Divorced</option>
          <option value="WIDOWED">Widowed</option>
        </select>
      </Field>
      {applicant.maritalStatus === 'MARRIED' && <Field label="Spouse full name"><input value={applicant.spouseName} onChange={event => onChange('spouseName', event.target.value)}/></Field>}
    </div>
    <div className="checks">
      {([
        ['disability', 'Disability declared'],
        ['disaster', 'Damage / disaster application'],
        ['propertyOwned', 'Property ownership declared'],
        ['propertySold', 'Property sale declared'],
      ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={applicant[key]} onChange={event => onChange(key, event.target.checked)}/>{label}</label>)}
    </div>
    {applicant.disaster && <Field label="Disaster / damage circumstances"><textarea value={applicant.disasterDetails} onChange={event => onChange('disasterDetails', event.target.value)}/></Field>}
  </>;
}
