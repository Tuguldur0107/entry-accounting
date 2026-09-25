// node web/costing_fill.mjs <YYYY-MM> <tag>  — /costing "үнэлгээ хүлээгдэж буй" мөрүүдэд нэгж өртөг (orgs/<org>/costmap.json: "CODE|QTY"->cost) бөглөж тооцоо ажиллуулна
import {open,shot,flush,BASE,setPeriod,ODIR} from '../common/harness.mjs';
import fs from 'fs'; import path from 'path';
const [,, ym, tag]=process.argv;
const cmap=JSON.parse(fs.readFileSync(path.join(ODIR,'costmap.json'),'utf8')); const miss=[];
const {browser,page}=await open({height:1600});
await setPeriod(page,ym);
for(let round=0;round<20;round++){
  await page.goto(BASE+'/costing',{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
  const rows=page.locator('.ag-center-cols-container .ag-row'); const n=await rows.count(); let filled=0;
  for(let i=0;i<n;i++){
    const r=rows.nth(i); const txt=await r.innerText(); const m=txt.match(/((?:IMP|MK|SRV)-[A-Z0-9]+)/); if(!m) continue;
    const inp=r.locator('input'); if(!(await inp.count())) continue;
    const q=(txt.match(/(\d+(?:\.\d+)?)\s*(?:ш|кг|удаа)/)||[])[1]; const k=m[1]+'|'+q; const doc=(txt.match(/(INV-\d{8}-[0-9A-F]+)/)||[])[1]; const v=(doc&&cmap[doc])??cmap[k]??cmap[m[1]]; if(v===undefined){miss.push(k); continue;}
    await inp.first().fill(String(v)); filled++;
  }
  console.log('round',round,'rows',n,'filled',filled);
  if(round===0) await shot(page,`${tag}-filled`);
  if(!filled) break;
  await page.getByRole('button',{name:/Өртгийн тооцоо ажиллуулах|Costing run/}).click(); await page.waitForTimeout(1500);
  const d=page.locator('[role=dialog],[role=alertdialog]'); if(await d.count()){ console.log('dlg',(await d.last().innerText()).slice(0,300).replace(/\n/g,' ')); const b=d.last().getByRole('button').filter({hasText:/Ажиллуулах|Тооцоолох|Батлах|Үргэлжлүүлэх/}); if(await b.count()) await b.last().click(); }
  for(let i=0;i<30;i++){ await page.waitForTimeout(1000); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} }
}
await shot(page,`${tag}-after`); console.log('missing keys',miss.slice(0,10), miss.length);
flush(); await browser.close();
