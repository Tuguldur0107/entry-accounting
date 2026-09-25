// node web/gr_delete.mjs <GR-NO> <YYYY-MM> — ноорог хүлээн авалтыг вэбээс устгах (мөрийн үйлдэл / дэлгэрэнгүй)
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, no, ym]=process.argv;
const {browser,page}=await open({height:2200});
await setPeriod(page,ym);
await page.goto(BASE+'/procurement/receipts?status=draft',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
const row=page.locator('.ag-row').filter({hasText:no}).first(); await row.waitFor({timeout:20000});
console.log('row btns',JSON.stringify(await row.getByRole('button').allInnerTexts()));
let b=row.getByRole('button',{name:/Устгах|Цуцлах/}).first();
if(!(await b.count())){ await row.dblclick(); await page.waitForTimeout(1500); b=page.getByRole('button',{name:/^(Устгах|Цуцлах)$/}).last(); console.log('detail btns',JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()).slice(-12))); }
if(!(await b.count())){ await shot(page,no+'-nodel'); flush(); await browser.close(); process.exit(3); }
await b.click(); await page.waitForTimeout(1000);
const d=page.locator('[role=dialog], [role=alertdialog]').last(); const dt=(await d.innerText().catch(()=>'')).replace(/\n+/g,' '); console.log('dlg',dt.slice(0,300));
const btns=d.locator('button'); const names=await btns.allInnerTexts(); const bi=names.findIndex(x=>x.trim()==='Болих'); if(bi>=0) await btns.nth(bi+1).click();
for(let i=0;i<20;i++){ await page.waitForTimeout(1000); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} }
await shot(page,no+'-del'); flush(); await browser.close();
