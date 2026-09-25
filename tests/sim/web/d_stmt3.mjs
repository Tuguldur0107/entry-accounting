import {open,shot,flush,BASE,ODIR} from '../common/harness.mjs';
import path from 'path';
import {fill,clickBtn,toast,dlgText} from './d_lib.mjs';
const {browser,page}=await open({height:1400,width:2200,slow:true});
const log=(...a)=>console.log(...a);
await page.goto(BASE+'/cash/statements',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
await page.locator('select').first().selectOption({index:1});
const [fc]=await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button',{name:/Хуулга сонгох/}).click()]);
await fc.setFiles(path.join(ODIR,'stmt_sep.csv')); await page.waitForTimeout(2500);
await page.getByRole('button',{name:/Хүчтэй саналыг/}).click().catch(()=>{}); await page.waitForTimeout(800);
async function dump(){ const rows=page.locator('.ag-center-cols-container .ag-row'); const n=await rows.count(); const out=[]; for(let i=0;i<n;i++){ const cells=rows.nth(i).locator('.ag-cell'); const m=await cells.count(); const r=[]; for(let j=0;j<m;j++){ r.push((await cells.nth(j).getAttribute('col-id'))+'='+(await cells.nth(j).innerText()).replace(/\n/g,' ').slice(0,28)); } out.push(r.join(' | ')); } return out; }
log('headers',JSON.stringify(await page.locator('.ag-header-cell-text').allInnerTexts()));
for(const r of await dump()) log(r);
for(const i of [1,2]){ const cell=page.locator('.ag-center-cols-container .ag-row').nth(i).locator('.ag-cell[col-id="debitAccountNumber"]'); await cell.dblclick(); await page.waitForTimeout(400); const ed=page.locator('.ag-popup input, .ag-cell-inline-editing input, .ag-cell-editor input').last(); if(await ed.count()){ await ed.fill('73100001'); await page.waitForTimeout(500); const portal=page.locator('[data-searchable-portal]').last(); const o=portal.locator('button').filter({hasText:'73100001'}).first(); if(await o.count()) await o.click(); else await page.keyboard.press('Enter'); } else { await page.keyboard.type('73100001'); await page.keyboard.press('Enter'); } await page.waitForTimeout(400); }
for(const r of await dump()) log('after',r.slice(0,220));
await shot(page,'d-stmt-3');
await page.getByRole('button',{name:/Хуулга хадгалж батлах/}).click(); await page.waitForTimeout(1000); log('dlg',await dlgText(page));
const d=page.locator('[role=dialog],[role=alertdialog]').last(); const names=await d.locator('button').allInnerTexts().catch(()=>[]); const bi=names.findIndex(x=>x.trim()==='Болих'); if(bi>=0) await d.locator('button').nth(bi+1).click();
log('toast',await toast(page,15000)); await page.waitForTimeout(1000); log('page',(await page.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,500));
await shot(page,'d-stmt-done'); flush(); await browser.close();
