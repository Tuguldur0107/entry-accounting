// node web/fa_dispose.mjs <name> <YYYY-MM> <date> <proceeds> <gainLossAcc> — ҮХ-ийг вэбээс данснаас хасах (борлуулалт)
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
import {fill,dlgText,toast} from './d_lib.mjs';
const [,, name, ym, date, proceeds, acc]=process.argv;
const {browser,page}=await open({height:2000,slow:true});
await setPeriod(page,ym);
await page.goto(BASE+'/fa/assets',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
const row=page.locator('.ag-row').filter({hasText:name}).first(); await row.waitFor({timeout:20000}); await row.dblclick(); await page.waitForTimeout(1500);
await page.getByRole('button',{name:/^Данснаас хасах$/}).last().click(); await page.waitForTimeout(900);
const d=page.locator('[role=dialog]').last(); console.log('dlg',(await dlgText(page)).slice(0,600));
const fields=await d.locator('label').allInnerTexts(); console.log('labels',JSON.stringify(fields));
await fill(d,'Огноо',date).catch(()=>{});
const sel=d.locator('select').first(); if(await sel.count()){ const opts=await sel.locator('option').allInnerTexts(); console.log('opts',JSON.stringify(opts)); const want=process.env.DTYPE||'Борлуул'; const o=opts.find(x=>new RegExp(want,'i').test(x)); if(o) await sel.selectOption({label:o}); }
if(proceeds && proceeds!=='0') await fill(d,'Борлуулсан үнэ',proceeds);
const gl=d.locator('input[placeholder*="олз"]').first(); await gl.click(); await gl.fill(acc); await page.keyboard.press('Tab'); await page.waitForTimeout(500);
console.log('dlg2',(await dlgText(page)).slice(0,400));
await shot(page,'fa-dispose-form');
const btns=await d.locator('button').allInnerTexts(); console.log('btns',JSON.stringify(btns));
const bi=btns.findIndex(x=>x.trim()==='Болих'); await d.locator('button').nth(bi+1).click();
console.log('toast',await toast(page)); await page.waitForTimeout(800); console.log('after',(await dlgText(page)).slice(0,300));
await shot(page,'fa-dispose-done'); flush(); await browser.close();
