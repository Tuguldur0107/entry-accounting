import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, name, ym]=process.argv;
const {browser,page}=await open({height:2000});
await setPeriod(page,ym);
await page.goto(BASE+'/fa/assets',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
const row=page.locator('.ag-row').filter({hasText:name}).first(); await row.waitFor({timeout:20000}); await row.dblclick(); await page.waitForTimeout(1500);
console.log('buttons',JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()).slice(-16)));
console.log((await page.locator('[role=dialog]').last().innerText().catch(()=>'')).replace(/\n+/g,' | ').slice(0,900));
await shot(page,'fa-detail'); flush(); await browser.close();
