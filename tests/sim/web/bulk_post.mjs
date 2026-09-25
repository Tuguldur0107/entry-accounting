// node web/bulk_post.mjs <path> <YYYY-MM> <tag>  — жагсаалтын "Ноорог N" → бүгдийг сонгох → "Сонгосныг батлах"
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,,path,ym,tag]=process.argv;
const {browser,page}=await open();
await setPeriod(page,ym);
await page.goto(BASE+path,{waitUntil:'networkidle'}); await page.waitForTimeout(800);
const nb=page.getByRole('button',{name:/^Ноорог\s*\d/}); if(!(await nb.count())){console.log('no drafts'); flush(); await browser.close(); process.exit(0);} await nb.first().click();
await page.locator('.ag-row').first().waitFor({timeout:30000}).catch(()=>{});
const sa=page.locator('.ag-header-select-all'); console.log('select-all',await sa.count());
if(await sa.count()) { await sa.first().click(); await page.waitForTimeout(700); }
const b=page.getByRole('button',{name:/Сонгосныг батлах|Батлах \(\d/}).first();
console.log('bulk btn',await b.count(), await b.innerText().catch(()=>''));
if(!(await b.count())){ console.log('buttons',JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()))); await shot(page,tag+'-nobulk'); flush(); await browser.close(); process.exit(3); }
await b.click(); await page.waitForTimeout(1000);
const d=page.locator('[role=dialog], [role=alertdialog]').last(); console.log((await d.innerText().catch(()=>'')).slice(0,300).replace(/\n/g,' '));
await d.locator('button').filter({hasText:/^Батлах/}).last().click();
for(let i=0;i<40;i++){ await page.waitForTimeout(1500); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} }
await shot(page,tag);
flush(); await browser.close();
