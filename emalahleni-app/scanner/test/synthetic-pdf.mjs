export function syntheticPdf(pages=1) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(let i=0;i<pages;i++) {
    const content='BT /F1 24 Tf 40 700 Td (SPECIMEN SYNTHETIC TEST ONLY) Tj 0 -50 Td (Surname: EXAMPLE) Tj 0 -50 Td (Names: SYNTHETIC PERSON) Tj 0 -50 Td (Identity number: 0001015009086) Tj ET';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let out='%PDF-1.4\n', offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(out);
  out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

