// node web/d_invoice.mjs <ap|ar> <counterparty> <date> <desc> <lines JSON [{item,qty,price,account,desc,amount}]> [draft]
import {open,shot,flush,BASE} from '../common/harness.mjs';
import {fill,clickBtn,toast,dlgText} from './d_lib.mjs';
const [,, kind, cp, date, desc, linesJson, draft]=process.argv;
const lines=JSON.parse(linesJson);
const {browser,page}=await open({height:1400,slow:true});
const log=(...a)=>console.log(...a);
await page.goto(BASE+(kind==='ap'?'/payables/documents':'/receivables/documents'),{waitUntil:'networkidle'}); await page.waitForTimeout(800);
await clickBtn(page,'^Нэхэмжлэх бүртгэх$|^Нэхэмжлэл үүсгэх$'); await page.waitForTimeout(2000);
let d=page.locator('[role=dialog]').last();
if(!(await d.getByRole('button',{name:/Харилцагч сонгох/}).count())){ log('dialogs',await page.locator('[role=dialog]').count()); d=page.locator('[role=dialog]').filter({hasText:'Харилцагч сонгох'}).last(); log('fallback',await d.count()); }
// харилцагч
await d.getByRole('button',{name:/Харилцагч сонгох/}).first().click(); await page.waitForTimeout(500);
const portal=page.locator('[data-searchable-portal]').last(); const pi=portal.locator('input').first(); if(await pi.count()){ await pi.fill(cp); await page.waitForTimeout(600); }
let opt=portal.locator('button').filter({hasText:cp}).first(); if(!(await opt.count())) opt=page.getByRole('option').filter({hasText:cp}).first();
if(await opt.count()) await opt.click(); else log('NOCP',cp);
await fill(d,'Огноо',date); await fill(d,'Журналын нэр',desc);
async function edit(row, colId, val, retry){
  const cell=d.locator('.ag-row').nth(row).locator(`.ag-cell[col-id="${colId}"]`).first();
  await cell.dblclick(); await page.waitForTimeout(400);
  const ed=page.locator('.ag-popup input, .ag-cell-inline-editing input, .ag-cell-editor input, .ag-popup-editor input').last();
  if(await ed.count()){ await ed.fill(String(val)); await page.waitForTimeout(500);
    const p2=page.locator('[data-searchable-portal]').last(); const o=p2.locator('button').filter({hasText:String(val)}).first();
    if(await o.count()) { await o.click(); } else { const o3=page.getByRole('option').filter({hasText:String(val)}).first(); if(await o3.count()) await o3.click(); else await page.keyboard.press('Enter'); }
  } else { await page.keyboard.type(String(val)); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(300);
  const txt=await d.locator('.ag-row').nth(row).locator(`.ag-cell[col-id="${colId}"]`).first().innerText().catch(()=>'');
  if(!txt.replace(/[,\s]/g,'').includes(String(val).replace(/[,\s]/g,'').slice(0,6)) && !retry){ log('retry',colId,val,'got',txt); return edit(row,colId,val,true); }
}
for(let i=0;i<lines.length;i++){
  const rows=await d.locator('.ag-row').count(); if(rows<=i) { await d.getByRole('button',{name:/Мөр нэмэх/}).first().click(); await page.waitForTimeout(500); }
  const l=lines[i];
  if(l.account) await edit(i,'account',l.account);
  if(l.desc) await edit(i,'description',l.desc);
  if(l.amount) await edit(i,'amount',l.amount);
  if(l.item){ await edit(i,'itemId',l.item); await edit(i,'quantity',l.qty); await edit(i,'unitPrice',l.price); if(l.wh) await edit(i,'warehouseId',l.wh); }
}
await page.keyboard.press('Escape').catch(()=>{});
const rowsTxt=[]; const rc=await d.locator('.ag-row').count(); for(let i=0;i<Math.min(rc,lines.length);i++) rowsTxt.push((await d.locator('.ag-row').nth(i).innerText()).replace(/\n/g,' | '));
log('rows',JSON.stringify(rowsTxt)); log('total',(await dlgText(page)).match(/Нийт \| [\d,\.]+/)?.[0]);
await shot(page,'d-inv-'+kind+'-filled');
await d.getByRole('button',{name:draft?/^Ноорог хадгалах$/:/^Батлах$/}).click(); const t=await toast(page); log('result:',t);
if(/алдаа|Алдаа|шаардлагатай|буруу/.test(t)) log('dlg',await dlgText(page));
await shot(page,'d-inv-'+kind+'-result'); flush(); await browser.close();
