// D · POS: ээлж нээх → 3 борлуулалт (бэлэн) → ээлж хаах — вэб UI
import {open,shot,flush,BASE} from '../common/harness.mjs';
import {fill,clickBtn,toast,dlgText} from './d_lib.mjs';
const {browser,page}=await open({height:1400,slow:true});
const log=(...a)=>console.log(...a);
await page.goto(BASE+'/inventory/pos',{waitUntil:'networkidle'}); await page.waitForTimeout(1200);
const d=page.locator('[role=dialog]').last();
if(await d.getByRole('button',{name:/^Ээлж нээх$/}).count()){ await fill(d,'Эхний мөнгө',100000); await d.getByRole('button',{name:/^Ээлж нээх$/}).click(); log('open:',await toast(page)); }
await shot(page,'d-pos-1');
const search=page.locator('input[placeholder*="Сканнер"]').first();
async function sale(items, payBtn){
  for(const [q,name] of items){ for(let i=0;i<q;i++){ await search.fill(name); await page.waitForTimeout(600); await search.press('Enter'); await page.waitForTimeout(500); } }
  log('cart',(await page.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,300));
  log('buttons',JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()).slice(-16)));
  await shot(page,'d-pos-cart');
  const pb=page.getByRole('button',{name:payBtn}).first(); if(!(await pb.count())){ log('NOPAY'); return; } await pb.click(); await page.waitForTimeout(900);
  log('paydlg',await dlgText(page));
  await shot(page,'d-pos-pay');
  const dd=page.locator('[role=dialog]').last();
  const cash=dd.getByRole('button',{name:/^Бэлэн$/}).first(); if(await cash.count()) { await cash.click(); await page.waitForTimeout(600); }
  log('after cash',await dlgText(page));
  const amt=dd.locator('input[type=number], input[inputmode=decimal], input[inputmode=numeric]').first(); if(await amt.count()){ const v=await amt.inputValue(); log('amt field',v); if(!v||v==='0') { const tot=(await dlgText(page)).match(/Төлөх ([\d,\.]+)/); if(tot) await amt.fill(tot[1].replace(/,/g,'')); } }
  const confirm=dd.getByRole('button',{name:/Батлаад хэвлэх|Батлах/}).first(); log('confirm btn',await confirm.innerText().catch(()=>''));
  await confirm.click(); log('sale:',await toast(page)); await page.waitForTimeout(1200);
  log('after sale',await dlgText(page));
  await shot(page,'d-pos-sold');
  await page.keyboard.press('Escape').catch(()=>{});
}
const plan=process.argv[2]||'a';
if(plan==='a') await sale([[2,'Кофе'],[1,'Ундаа']], /ТӨЛБӨР|F9/);
if(plan==='b'){ await page.keyboard.press('Escape'); await sale([[3,'Цай'],[2,'Ундаа']], /ТӨЛБӨР|F9/); await page.keyboard.press('Escape'); await page.waitForTimeout(500); await sale([[1,'Кофе'],[4,'Ундаа']], /ТӨЛБӨР|F9/); }
if(plan==='close'){
  await page.keyboard.press('Escape'); await clickBtn(page,'^Ээлж хаах$'); await page.waitForTimeout(900);
  const dd=page.locator('[role=dialog]').last(); log('closedlg',await dlgText(page));
  const inp=dd.locator('input[type=number]').first(); const txt=await dlgText(page); const sys=txt.match(/[Сс]истем[^\d]*([\d,\.]+)/); const expect=sys?parseFloat(sys[1].replace(/,/g,'')):100000;
  await inp.fill(String(expect-2000)); await page.waitForTimeout(400); log('counted',expect-2000);
  const cb=dd.getByRole('button',{name:/^Ээлж хаах$|Хаах$/}).first(); await cb.click(); log('close:',await toast(page)); await shot(page,'d-pos-closed'); log('after',await dlgText(page));
}
flush(); await browser.close();
