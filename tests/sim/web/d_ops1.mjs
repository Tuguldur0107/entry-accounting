// D · үйл ажиллагаа 1: эздийн хөрөнгө оруулалт (орлого), банк→касс шилжүүлэг
import {open,shot,flush,BASE} from '../common/harness.mjs';
import {fill,clickBtn,toast,dlgText} from './d_lib.mjs';
const {browser,page}=await open({height:1800,slow:true});
const log=(...a)=>console.log(...a);
async function selectContains(d,label,part){ const sel=d.locator('label').filter({hasText:label}).first().locator('xpath=following::select[1]'); const opts=await sel.locator('option').allInnerTexts(); const o=opts.find(x=>x.includes(part)); if(o) await sel.selectOption({label:o}); else log('NOOPT',part,opts.slice(0,5)); }
async function newTx(kind, f){
  await page.goto(BASE+'/cash/transactions',{waitUntil:'networkidle'}); await page.waitForTimeout(700);
  await clickBtn(page,'^Шинэ гүйлгээ$'); await page.waitForTimeout(700);
  const d=page.locator('[role=dialog]').last();
  await d.getByRole('button',{name:new RegExp('^'+kind+'$')}).click(); await page.waitForTimeout(400);
  await f(d);
  await d.getByRole('button',{name:/^Хадгалж батлах$/}).click(); const t=await toast(page); log(kind,':',t); return t;
}
async function pickGL(d, code){
  const inp=d.locator('input[placeholder="GL данс..."]').first(); await inp.click(); await inp.fill(code); await page.keyboard.press('Tab'); await page.waitForTimeout(400);
}
await newTx('Орлого', async d=>{ await fill(d,'Огноо','2026-09-01'); await fill(d,'Дүн',15000000); await fill(d,'Хүлээн авах данс','Хаан банк MNT · MNT · 0.00'); await pickGL(d,'41000001'); await selectContains(d,'Мөнгөн гүйлгээний ангилал','3101'); await fill(d,'Журналын нэр','Эздийн хөрөнгө оруулалт'); log(await dlgText(page)); });
await shot(page,'d8-capital');
await newTx('Шилжүүлэг', async d=>{ await fill(d,'Огноо','2026-09-02'); await fill(d,'Дүн',1000000); const sels=d.locator('select'); log('selects',await sels.count()); await sels.nth(0).selectOption({index:2}).catch(()=>{}); await sels.nth(1).selectOption({index:1}).catch(()=>{}); await fill(d,'Журналын нэр','Банкнаас касс'); log(await dlgText(page)); });
await shot(page,'d8-transfer');
flush(); await browser.close();
