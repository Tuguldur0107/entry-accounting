// node web/po_action.mjs <PO-NO> <YYYY-MM> <approve|close> [tag]
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, no, ym, action, tag]=process.argv;
const {browser,page}=await open({height:2200});
await setPeriod(page,ym);
await page.goto(BASE+'/procurement/orders',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
const row=page.locator('.ag-row').filter({hasText:no}).first(); await row.waitFor({timeout:20000}); await row.dblclick(); await page.waitForTimeout(1500);
const label = action==='approve' ? /^Батлах$/ : /^PO хаах$/;
const b=page.getByRole('button',{name:label}).last();
if(!(await b.count())){ console.log('no button', action, JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()).slice(-12))); await shot(page,(tag||no)+'-nobtn'); flush(); await browser.close(); process.exit(3); }
await b.click(); await page.waitForTimeout(1200);
const d=page.locator('[role=dialog], [role=alertdialog]').last();
const dt=(await d.innerText().catch(()=>'')).replace(/\n+/g,' ');
console.log('dlg',dt.slice(0,400));
// баталгаажуулах диалог (хаалтын огноо г.м) — сүүлийн Батлах/Хаах товч
const btns=d.locator('button'); const names=await btns.allInnerTexts(); const bi=names.findIndex(x=>x.trim()==='Болих');
if(bi>=0 && /уу\?|баталгаажуул/i.test(dt)) { await btns.nth(bi+1).click(); console.log('confirm click', names[bi+1]); }
for(let i=0;i<30;i++){ await page.waitForTimeout(1200); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} }
await shot(page,tag||`${no}-${action}`);
flush(); await browser.close();
