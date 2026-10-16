import React from 'react';
import type {ExportSnapshot} from '../../src/export-contracts';
import {packEvidence} from '../../src/export-contracts';
export async function summaryPdf(snapshot:ExportSnapshot):Promise<Blob>{
 const {Document,Page,Text,View,StyleSheet,pdf}=await import('@react-pdf/renderer');
 const styles=StyleSheet.create({page:{padding:36,fontFamily:'Helvetica',fontSize:10,lineHeight:1.5},title:{fontSize:20,marginBottom:8,color:'#0A2540'},draft:{fontSize:10,color:'#9a492e',marginBottom:15},heading:{fontSize:13,marginTop:16,marginBottom:6},row:{flexDirection:'row',marginBottom:5},label:{width:135,color:'#52667A'},value:{flex:1},issue:{marginBottom:5},footer:{position:'absolute',bottom:20,left:36,right:36,fontSize:8,color:'#52667A'}});
 const row=(label:string,value:unknown)=><View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value===null||value===undefined||value===''?'Not recorded':String(value)}</Text></View>;
 const a=snapshot.form.applicant,h=snapshot.form.household,s=snapshot.form.site;
 const document=<Document title={`DRAFT - ${snapshot.reference} - Vectra Assure`} author="Vectra Solutions" subject="Draft verification summary — not submission approval">
 <Page size="A4" style={styles.page}><Text style={styles.title}>Beneficiary verification summary</Text><Text style={styles.draft}>{snapshot.preview?'PREVIEW — UNSAVED FORM':'DRAFT — NOT APPROVED FOR SUBMISSION'}</Text>
 {row('Case reference',snapshot.reference)}{row('Recorded version',snapshot.version)}{row('Generated (UTC)',snapshot.generatedAt)}
 <Text style={styles.heading}>Applicant and household</Text>{row('Applicant',`${a.firstNames} ${a.surname}`)}{row('ID number',a.idNumber)}{row('Contact',a.phone)}{row('Marital status',a.maritalStatus)}{a.maritalStatus==='MARRIED'&&row('Spouse',a.spouseName)}{row('Income declaration',h.incomeSource)}{row('Disability declared',a.disability?'Yes':'No')}{row('Disaster declared',a.disaster?'Yes':'No')}
 {h.dependants.map((d,i)=><View key={i}>{row(`Dependant ${i+1}`,`${d.name} · ${d.relationship}`)}</View>)}
 <Text style={styles.heading}>Site verification</Text>{row('House type',s.houseType)}{row('House type confirmed',s.houseTypeConfirmed?'Yes':'No')}{row('Latitude / longitude',`${s.latitude??'—'} / ${s.longitude??'—'}`)}{row('Verification date',s.verificationDate)}{row('Photo parameters confirmed',s.photoParametersConfirmed?'Yes':'No')}{row('Recommendation',s.recommendation)}
 <Text style={styles.heading}>Readiness and next actions</Text>{row('Our team',snapshot.readiness.ourTeamReady?'Ready':'Outstanding actions')}{row('Departmental work',snapshot.readiness.departmentalReady?'Complete':'Outstanding actions')}{row('Submission readiness','Not approved — provisional rules')}{row('Rule version',snapshot.readiness.ruleVersion)}
 {snapshot.readiness.issues.map(issue=><Text key={issue.code} style={styles.issue}>{issue.owner==='DOHS'?'DoHS':'Our team'}: {issue.message}</Text>)}
 <Text style={styles.heading}>Evidence register</Text>{snapshot.evidence.length?snapshot.evidence.map(e=><Text key={e.id} style={styles.issue}>{e.filename} · {e.kind} · {e.status} · scan {e.malware_status}{e.reviewed_by?` · reviewer ${e.reviewed_by}`:''}</Text>):<Text>No supporting evidence recorded.</Text>}
 <Text style={styles.heading}>DoHS section decisions</Text>{snapshot.reviews.length?snapshot.reviews.map(r=><Text key={r.section} style={styles.issue}>{r.section}: {r.state} · {r.note}</Text>):<Text>No departmental decisions recorded.</Text>}
 <Text fixed style={styles.footer} render={({pageNumber,totalPages})=>`Vectra Assure by Vectra Solutions · Draft verification summary · Page ${pageNumber} of ${totalPages}`}/>
 </Page></Document>;
 return pdf(document).toBlob();
}
export async function draftPack(snapshot:ExportSnapshot,getFile:(id:string)=>Promise<ArrayBuffer>,recheck:()=>Promise<string>):Promise<Blob>{
 if(snapshot.preview)throw Error('Save and load a recorded case before generating an evidence pack.');
 const evidence=packEvidence(snapshot.evidence);if(evidence.length>20)throw Error('This draft pack exceeds the 20-document export limit.');
 const {PDFDocument,PDFName}=await import('pdf-lib');const result=await PDFDocument.create();
 result.setTitle(`DRAFT - ${snapshot.reference} - Vectra Assure`);result.setAuthor('Vectra Solutions');result.setSubject('Draft verification pack — not approved for submission');
 const summary=await PDFDocument.load(await (await summaryPdf(snapshot)).arrayBuffer());for(const page of await result.copyPages(summary,summary.getPageIndices()))result.addPage(page);
 let size=0;
 for(const e of evidence){
  const bytes=await getFile(e.id);size+=bytes.byteLength;if(bytes.byteLength>5*1024*1024||size>25*1024*1024)throw Error('This draft pack exceeds the export size limit.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==e.sha256)throw Error('An evidence file changed. Refresh the case before exporting.');
  if(e.content_type==='application/pdf'){
   let donor;try{donor=await PDFDocument.load(bytes);donor.getForm().flatten();}catch{throw Error(`Unable to include ${e.filename}. Check for password protection or an unsupported PDF form.`);}
   if(result.getPageCount()+donor.getPageCount()>200)throw Error('This draft pack exceeds the 200-page export limit.');
   // Printed copies retain flattened form values; interactive annotations/actions are omitted.
   for(const page of donor.getPages()){page.node.delete(PDFName.of('Annots'));page.node.delete(PDFName.of('AA'));}
   for(const page of await result.copyPages(donor,donor.getPageIndices()))result.addPage(page);
  }else if(['image/jpeg','image/png'].includes(e.content_type)){
   const image=e.content_type==='image/png'?await result.embedPng(bytes):await result.embedJpg(bytes);const page=result.addPage([595,842]);const scale=Math.min(523/image.width,690/image.height);page.drawImage(image,{x:36,y:80,width:image.width*scale,height:image.height*scale});
  }else throw Error('Unsupported evidence type.');
 }
 if(await recheck()!==snapshot.fingerprint)throw Error('The case or evidence register changed during export. Generate a fresh pack.');
 return new Blob([new Uint8Array(await result.save()).buffer],{type:'application/pdf'});
}
