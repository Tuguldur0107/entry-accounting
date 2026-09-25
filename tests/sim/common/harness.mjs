import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
export const ORG=process.env.SIM_ORG||'C';
export const ROOT=new URL('..',import.meta.url).pathname;
export const ODIR=path.join(ROOT,'orgs',ORG);
// Тохиргоо env-ээс (нууц repo-д орохгүй): SIM_BASE (default ЛОКАЛ — production-ийг
// санамсаргүй цохихгүй), SIM_EMAIL / SIM_NAME / SIM_PASSWORD. Байхгүй бол
// orgs/<ORG>/creds.json, common/.pw (хоёулаа .gitignore-д) — README.md.
export const BASE=process.env.SIM_BASE||'http://localhost:3000';
fs.mkdirSync(ODIR,{recursive:true});
const credsFile=path.join(ODIR,'creds.json');
const creds=fs.existsSync(credsFile)?JSON.parse(fs.readFileSync(credsFile,'utf8')):{};
export const EMAIL=process.env.SIM_EMAIL||creds.email;
export const NAME=process.env.SIM_NAME||creds.name||`SIM ${ORG}`;
const pwFile=path.join(ROOT,'common/.pw');
export const PASS=process.env.SIM_PASSWORD||(fs.existsSync(pwFile)?fs.readFileSync(pwFile,'utf8').trim():'');
if(!EMAIL||!PASS) throw new Error(`SIM_EMAIL / SIM_PASSWORD (эсвэл orgs/${ORG}/creds.json, common/.pw) тохируулна уу — tests/sim/README.md`);
export const log=[];
export async function open({width=1440,height=900,state=true,mobile=false,role='owner'}={}){
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const st=path.join(ODIR,role==='owner'?'state.json':`state-${role}.json`);
  const ctx=await browser.newContext({viewport:{width,height},locale:'mn-MN',timezoneId:'Asia/Ulaanbaatar',
    storageState: state && fs.existsSync(st)?st:undefined, isMobile:mobile, hasTouch:mobile});
  const page=await ctx.newPage();
  page.on('console',m=>{ if(['error','warning'].includes(m.type())) log.push({t:'console',type:m.type(),url:page.url(),text:m.text().slice(0,400)})});
  page.on('pageerror',e=>log.push({t:'pageerror',url:page.url(),text:String(e).slice(0,400)}));
  page.on('response',r=>{ if(r.status()>=400) log.push({t:'http',status:r.status(),url:r.url().slice(0,200),page:page.url()})});
  page.on('requestfinished',async r=>{ try{const t=r.timing(); if(t.responseEnd>2500) log.push({t:'slow',ms:Math.round(t.responseEnd),url:r.url().slice(0,200)})}catch{} });
  return {browser,ctx,page,stateFile:st};
}
export async function shot(page,name){ const d=path.join(ODIR,'shots'); fs.mkdirSync(d,{recursive:true}); await page.screenshot({path:path.join(d,`${name}.png`),fullPage:false}); }
export function flush(){ const f=path.join(ODIR,'weblog.jsonl'); fs.appendFileSync(f, log.map(x=>JSON.stringify({org:ORG,...x})).join('\n')+(log.length?'\n':'')); log.length=0; }
export async function setPeriod(page,ym){ await page.context().addCookies([{name:'ea-period',value:`${ym}:ptd`,domain:new URL(BASE).host,path:'/'}]); }
