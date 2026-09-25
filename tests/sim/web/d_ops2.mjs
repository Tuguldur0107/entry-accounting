// D · төлбөр тооцоо: АР орлого (нэхэмжлэх холбоотой), АП төлбөр (нэхэмжлэх холбоотой)
import {open,shot,flush,BASE} from '../common/harness.mjs';
import {fill,clickBtn,toast,dlgText} from './d_lib.mjs';
const {browser,page}=await open({height:1400,slow:true});
const log=(...a)=>console.log(...a);
async function selectContains(d,label,part){ const sel=d.locator('label').filter({hasText:label}).first().locator('xpath=following::select[1]'); const opts=await sel.locator('option').allInnerTexts(); const o=opts.find(x=>x.includes(part)); if(o) await sel.selectOption({label:o}); else log('NOOPT',label,part,opts.slice(0,6)); return o; }
async function newTx(kind, f){
  await page.goto(BASE+'/cash/transactions',{waitUntil:'networkidle'}); await page.waitForTimeout(700);
  await clickBtn(page,'^Шинэ гүйлгээ$'); await page.waitForTimeout(700);
  const d=page.locator('[role=dialog]').last();
  await d.getByRole('button',{name:new RegExp('^'+kind+'$')}).click(); await page.waitForTimeout(400);
  await f(d);
  await d.getByRole('button',{name:/^Хадгалж батлах$/}).click(); const t=await toast(page); log(kind,':',t); if(!t) log('dlg',await dlgText(page)); return t;
}
async function pickCp(d,name){ await d.getByRole('button',{name:/Бүртгэлээс сонгох/}).first().click(); await page.waitForTimeout(500); const portal=page.locator('[data-searchable-portal]').last(); const pi=portal.locator('input').first(); if(await pi.count()){ await pi.fill(name); await page.waitForTimeout(500);} const o=portal.locator('button').filter({hasText:name}).first(); if(await o.count()) await o.click(); else log('NOCP',name); await page.waitForTimeout(700); }
async function pickCombo(d,label,part){ const btn=d.locator('label').filter({hasText:label}).first().locator('xpath=following::button[1]'); await btn.click(); await page.waitForTimeout(600); const portal=page.locator('[data-searchable-portal]').last(); const o=portal.locator('button').filter({hasText:part}).first(); if(await o.count()){ const t=(await o.innerText()).replace(/\n/g,' '); await o.click(); return t; } log('NOCOMBO',label,part,(await portal.innerText().catch(()=>'')).slice(0,200)); await page.keyboard.press('Escape'); return null; }
const what=process.argv[2]||'all';
if(what==='all'||what==='ar'){
await newTx('Орлого', async d=>{ await fill(d,'Огноо','2026-09-15'); await fill(d,'Дүн',360000); await selectContains(d,'Хүлээн авах данс','Хаан банк'); await pickCp(d,'Номин'); log('inv opt:',await pickCombo(d,'Авлагын нэхэмжлэлээс','AR-2026')); await page.waitForTimeout(600); await selectContains(d,'Мөнгөн гүйлгээний ангилал','1101'); await fill(d,'Журналын нэр','Номин Холдинг төлбөр'); log(await dlgText(page)); });
await shot(page,'d9-ar-receipt');
}
if(what==='all'||what==='ap'){
await newTx('Зарлага', async d=>{ await fill(d,'Огноо','2026-09-08'); await fill(d,'Дүн',1200000); await selectContains(d,'Гаргах данс','Хаан банк'); await pickCp(d,'Сүхбаатар'); log('inv opt:',await pickCombo(d,'Өглөгийн нэхэмжлэхээс','AP-2026')); await page.waitForTimeout(600); await selectContains(d,'Мөнгөн гүйлгээний ангилал','1102'); await fill(d,'Журналын нэр','Түрээс төлөв'); log(await dlgText(page)); });
await shot(page,'d9-ap-payment');
}
flush(); await browser.close();
