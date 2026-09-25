import {open,shot,flush,BASE} from '../common/harness.mjs';
import {clickBtn} from './d_lib.mjs';
const [,, path, btn]=process.argv;
const {browser,page}=await open({height:1400});
await page.goto(BASE+path,{waitUntil:'networkidle'}); await page.waitForTimeout(800);
await clickBtn(page,btn); await page.waitForTimeout(1500);
const d=page.locator('[role=dialog]').last();
await d.getByRole('button',{name:/Мөр нэмэх/}).first().click(); await page.waitForTimeout(800);
console.log('headers',JSON.stringify(await d.locator('.ag-header-cell-text').allInnerTexts()));
const cells=d.locator('.ag-row').first().locator('.ag-cell'); const n=await cells.count(); const out=[];
for(let i=0;i<n;i++){ const c=cells.nth(i); out.push((await c.getAttribute('col-id'))+':'+((await c.innerText().catch(()=>'')).slice(0,20))); }
console.log('row0',JSON.stringify(out));
await cells.nth(1).dblclick(); await page.waitForTimeout(600);
console.log('editor',JSON.stringify(await d.locator('.ag-cell-editor, .ag-popup-editor, .ag-cell-inline-editing').allInnerTexts()), await page.locator('.ag-popup input, .ag-cell-inline-editing input').count());
await shot(page,'dbg-inv'); flush(); await browser.close();
