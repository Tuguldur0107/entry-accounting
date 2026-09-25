// D · ноорог хөдөлгөөнүүдийг вэбээс батлах (/inventory/movements?status=draft → мөр бүр «Батлах»)
import {open,shot,flush,BASE} from '../common/harness.mjs';
import {toast} from './d_lib.mjs';
const {browser,page}=await open({height:1600});
await page.goto(BASE+'/inventory/movements?status=draft',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
for(let i=0;i<20;i++){
  const rows=page.locator('.ag-row'); const n=await rows.count(); if(!n) break;
  const row=rows.first(); console.log('row',(await row.innerText()).replace(/\n/g,' | ').slice(0,120));
  let b=row.getByRole('button',{name:/Батлах/}).first();
  if(!(await b.count())){ await row.dblclick(); await page.waitForTimeout(1200); b=page.getByRole('button',{name:/^Батлах$|Баталгаажуулах/}).last(); }
  if(!(await b.count())){ console.log('nobtn',JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()).slice(-12))); await shot(page,'d-mv-nobtn'); break; }
  await b.click(); await page.waitForTimeout(800);
  const d=page.locator('[role=alertdialog], [role=dialog]').last(); const names=await d.locator('button').allInnerTexts().catch(()=>[]); const bi=names.findIndex(x=>x.trim()==='Болих'); if(bi>=0 && /уу\?/.test(await d.innerText().catch(()=>''))) await d.locator('button').nth(bi+1).click();
  console.log('toast',await toast(page,8000)); await page.waitForTimeout(800);
  await page.goto(BASE+'/inventory/movements?status=draft',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
}
await shot(page,'d-mv-done'); flush(); await browser.close();
