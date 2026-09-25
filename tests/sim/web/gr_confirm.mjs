// node web/gr_confirm.mjs <GR-NO> <YYYY-MM> [tag] — ноорог хүлээн авалтыг мөрийн «Батлах» эсвэл дэлгэрэнгүйгээс батална
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, no, ym, tag]=process.argv;
const {browser,page}=await open({height:2200});
await setPeriod(page,ym);
await page.goto(BASE+'/procurement/receipts?status=draft',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
const row=page.locator('.ag-row').filter({hasText:no}).first(); await row.waitFor({timeout:20000});
let b=row.getByRole('button',{name:/Батлах/}).first();
if(!(await b.count())){ await row.dblclick(); await page.waitForTimeout(1500); b=page.getByRole('button',{name:/^Батлах$/}).last(); }
if(!(await b.count())){ console.log('no btn', JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()).slice(-15))); await shot(page,(tag||no)+'-nobtn'); flush(); await browser.close(); process.exit(3); }
await b.click(); await page.waitForTimeout(1200);
const d=page.locator('[role=dialog], [role=alertdialog]').last(); const dt=(await d.innerText().catch(()=>'')).replace(/\n+/g,' '); console.log('dlg',dt.slice(0,300));
const cb=d.locator('button').filter({hasText:/^Батлах/}).last(); if(await cb.count() && /уу\?|баталгаажуул/i.test(dt)) await cb.click();
for(let i=0;i<30;i++){ await page.waitForTimeout(1200); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} }
await shot(page,tag||`${no}-confirm`); flush(); await browser.close();
