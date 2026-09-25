import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const {browser,page}=await open();
await setPeriod(page,'2024-12');
await page.goto(BASE+'/gl/journal',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
await page.getByRole('button',{name:/^Ноорог/}).click(); await page.waitForTimeout(1000);
// status icon aria
const ic=page.locator('.ag-center-cols-container .ag-row').first().locator('svg, [role=img], button').first();
console.log('first cell html', (await page.locator('.ag-pinned-left-cols-container .ag-row').first().innerHTML().catch(()=>'')).slice(0,600));
// try select all via header checkbox / keyboard
const hdr=page.locator('.ag-header-select-all'); console.log('select-all',await hdr.count());
if(await hdr.count()){ await hdr.first().click(); await page.waitForTimeout(600); }
else { await page.locator('.ag-center-cols-container .ag-row').first().click({modifiers:['Shift']}); await page.locator('.ag-center-cols-container .ag-row').last().click({modifiers:['Shift']}); await page.waitForTimeout(600);}
const btns=await page.getByRole('button').allInnerTexts(); console.log('buttons',JSON.stringify(btns.filter(x=>x.trim())));
await shot(page,'11-journal-drafts');
flush(); await browser.close();
