// One-time provisioning utility: reads credentials over stdin, never arguments.
import {existsSync,readFileSync} from 'node:fs';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import postgres from 'postgres';
let input='';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stdin.on('data',async chunk=>{
  input+=chunk;if(!/[\r\n]/.test(input))return;process.stdin.pause();
  try{
    const {url}=JSON.parse(input.split(/[\r\n]/)[0]);input='';
    const db=postgres(url,{max:1,prepare:false,ssl:{rejectUnauthorized:true,ca:readFileSync(new URL('../server/backend/supabase-ca.crt',import.meta.url),'utf8')},connect_timeout:15});
    try{const rows=await db.unsafe('SELECT current_user AS role');if(rows[0]?.role!=='mya_runtime')throw new Error('Unexpected runtime role.');}finally{await db.end({timeout:5});}
    const cli=(process.env.PATH||'').split(delimiter).map(p=>join(p,'..','vercel','dist','vc.js')).find(existsSync);
    if(!cli)throw new Error('Run this utility through npx --package vercel@65.14.0 node.');
    const result=spawnSync(process.execPath,[cli,'env','add','POSTGRES_URL','--environment','production','--type','secret','--scope','team_idX53HqSADt11URLNGX4WhPY','--yes'],{input:url,encoding:'utf8',windowsHide:true});
    if(result.status!==0)throw new Error('Vercel environment update failed.');
    console.log('Verified restricted runtime connection and saved POSTGRES_URL as a Production Secret.');
    process.exit(0);
  }catch(error){console.error('Runtime provisioning failed.',{code:error.code||'CONFIGURATION_ERROR',message:error.code?'Connection or permission check failed.':error.message});process.exit(1);}
});
console.log('Waiting for runtime credentials over stdin.');
