// Runs inside the authorised Cloudflare Workers Builds environment. Credentials never enter source or logs.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(await readFile(join(root,'wrangler.jsonc'),'utf8'));
const scannerConfig='scanner/wrangler.jsonc',scannerName='emalahleni-scanner-staging';
const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js');
function command(executable,args,{cwd=root,input,quiet=false}={}){
 return new Promise((accept,reject)=>{
  const child=spawn(executable,args,{cwd,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:[input===undefined?'ignore':'pipe',quiet?'ignore':'inherit','inherit']});
  child.once('error',()=>reject(new Error('Deployment command could not start.')));
  child.once('exit',code=>code===0?accept():reject(new Error('Deployment command failed. Review the provider error above.')));
  if(input!==undefined){child.stdin.on('error',()=>{});child.stdin.end(input+'\n');}
 });
}
const cli=(args,options)=>command(process.execPath,[wrangler,...args],options);
async function scannerBootstrapped(){
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!token)throw new Error('Cloudflare build API authentication is not configured.');
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers/scripts/${scannerName}/settings`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 if(response.status===404)return false;
 if(!response.ok)throw new Error(`Unable to inspect private scanner configuration (HTTP ${response.status}). Check the selected build token permissions.`);
 const data=await response.json();
 return data.result?.bindings?.some(binding=>binding.name==='DOCUMENT_SERVICE_CONFIGURED'&&binding.text==='1')===true;
}
try{
 console.log('Checking permission to deploy the private document scanner.');
 // Fail before an image build or application change if the selected build token lacks Containers access.
 await cli(['containers','list','--config',scannerConfig,'--json'],{quiet:true});
 const bootstrapped=await scannerBootstrapped();
 await command('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{cwd:join(root,'scanner')});
 await command('npm',['run','typecheck'],{cwd:join(root,'scanner')});
 await cli(['deploy','--config',scannerConfig,'--keep-vars']);
 if(!bootstrapped){
  console.log('Configuring matching private scanner credentials.');
  let scannerToken=randomBytes(48).toString('base64url');
  await cli(['secret','put','SCANNER_TOKEN','--config',scannerConfig],{input:scannerToken,quiet:true});
  await cli(['secret','put','SCANNER_TOKEN','--name',config.name,'--config','wrangler.jsonc'],{input:scannerToken,quiet:true});
  scannerToken='';
  // Mark only a completed two-sided configuration. Interrupted setup is safely reconfigured on retry.
  await cli(['deploy','--config',scannerConfig,'--var','DOCUMENT_SERVICE_CONFIGURED:1','--keep-vars']);
 }
 // Apply the canonical API configuration only after its private target exists. Source activation flags remain off.
 await cli(['deploy','--config','wrangler.jsonc']);
 console.log('Scanner provisioned and bound. Live readiness/upload/OCR acceptance is required before feature activation.');
}catch(error){console.error(error instanceof Error?error.message:'Document deployment failed.');console.error('No upload or ID-reading feature was enabled. Containers permission may need to be added to the selected Workers Builds token.');process.exitCode=1;}
