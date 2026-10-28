/**
 * SC-I07 read-only synthetic Drive access acceptance.
 *
 * Run using a SHORT-LIVED OAuth access token obtained from the very same
 * isolated Smart Capture service account (never from the operator's personal
 * Drive session). This script NEVER downloads file bytes, writes Drive data,
 * creates imports or touches Neon/Cloudflare.
 *
 * SMART_CAPTURE_SYNTHETIC_DRIVE_ACCESS_TOKEN=<masked in environment> \
 *   node --import tsx scripts/check-smart-capture-drive-access.ts
 */
import {listBeneficiaryFolders} from '../src/smart-capture-folders';
import {listBeneficiaryPdfs} from '../src/smart-capture-drive';

const ROOT='1jTDNtpo0KAp27vf4f6G6eBTYc8HKS2tA';
const CHILD='1ukw-8tFxcdfB2G-L8fs_VBKBOhsQNSh5';
const FILE='1YUJLAGci2yHXAXpwKFYJtfthQK9MnGZd';
const token=process.env.SMART_CAPTURE_SYNTHETIC_DRIVE_ACCESS_TOKEN;
const configuredRoot=process.env.SMART_CAPTURE_SYNTHETIC_DRIVE_ROOT;
if(configuredRoot && configuredRoot!==ROOT)throw Error('SYNTHETIC_DRIVE_ROOT_MISMATCH');
if(!token||/\s/.test(token))throw Error('SYNTHETIC_DRIVE_ACCESS_TOKEN_REQUIRED');
try{
 const page=await listBeneficiaryFolders({rootFolderId:ROOT,accessToken:token});
 if(page.nextPageToken!==null||page.folders.length!==1||page.folders[0].id!==CHILD)
  throw Error('SYNTHETIC_DRIVE_FOLDER_SCOPE_MISMATCH');
 const pdfs=await listBeneficiaryPdfs({approvedFolderId:CHILD,accessToken:token});
 if(pdfs.nextPageToken!==null||pdfs.files.length!==1||
  pdfs.files[0].providerFileId!==FILE||
  pdfs.files[0].sizeBytes!==27213)
  throw Error('SYNTHETIC_DRIVE_PDF_SCOPE_MISMATCH');
 console.log(JSON.stringify({test:'SC-I07_DRIVE_METADATA_ONLY',result:'PASS',
  folders:1,pdfs:1,bytesDownloaded:0,source:'synthetic-only'}));
}catch{
 console.error(JSON.stringify({test:'SC-I07_DRIVE_METADATA_ONLY',result:'FAIL',
  reason:'Access denied, unexpected contents, or provider error; check isolated credentials and folder permission without printing tokens.'}));
 process.exitCode=1;
}
