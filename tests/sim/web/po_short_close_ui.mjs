// ENT-064: PO панелийн «Дутуу хаах» диалог.
// node web/po_short_close_ui.mjs <PO-NO> <YYYY-MM> <writeOffAccount|-> <reason> [tag]
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, no, ym, account, reason, tag='shortclose']=process.argv;
const {browser,page}=await open({height:2000});
await setPeriod(page,ym);
await page.goto(BASE+'/procurement/orders',{waitUntil:'networkidle'}); await page.waitForTimeout(1200);
const row=page.locator('.ag-row').filter({hasText:no}).first(); await row.waitFor({timeout:20000}); await row.dblclick(); await page.waitForTimeout(1800);
await shot(page,`${tag}-panel`);
const b=page.getByRole('button',{name:/^Дутуу хаах$/}).first();
if(!(await b.count())){ console.log('no short-close button', JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()).slice(-14))); flush(); await browser.close(); process.exit(3); }
console.log('button enabled', await b.isEnabled());
await b.click(); await page.waitForTimeout(800);
const d=page.locator('[role=dialog]').filter({hasText:/Дутуу хаах/}).last(); // Next dev overlay нь мөн role=dialog
console.log('dialog', (await d.innerText()).replace(/\n+/g,' | ').slice(0,600));
if(account!=='-'){
  await d.getByRole('button',{name:/Зардлын данс сонгох/}).click(); await page.waitForTimeout(400);
  await page.keyboard.type(account); await page.waitForTimeout(500);
  // Enter нь эхний «— Хоосон» мөрийг сонгодог — дансыг өөрийг нь дарна.
  await page.getByText(account,{exact:true}).last().click(); await page.waitForTimeout(400);
}
await d.locator('textarea').fill(reason);
await shot(page,`${tag}-dialog`);
await d.getByRole('button',{name:/^Дутуу хаах$/}).click();
for(let i=0;i<25;i++){ await page.waitForTimeout(800); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} const e=await d.locator('p').allInnerTexts().catch(()=>[]); const err=e.find(x=>/\[|алдаа|байна/.test(x)); if(err&&i>3){console.log('dialog-error',err);break;} }
await page.waitForTimeout(1500);
await shot(page,`${tag}-closed`);
flush(); await browser.close();
