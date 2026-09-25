import {open,shot,flush,BASE} from '../common/harness.mjs';
import {toast,dlgText,clickBtn} from './d_lib.mjs';
const [,, action]=process.argv;
const {browser,page}=await open({height:1800,slow:true});
const log=(...a)=>console.log(...a);
await page.goto(BASE+'/close',{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
if(action==='costing'){ await clickBtn(page,'^Өртөг тооцох$'); await page.waitForTimeout(1000); log('dlg',await dlgText(page)); const d=page.locator('[role=dialog],[role=alertdialog]').last(); const names=await d.locator('button').allInnerTexts().catch(()=>[]); const bi=names.findIndex(x=>x.trim()==='Болих'); if(bi>=0) await d.locator('button').nth(bi+1).click(); log('toast',await toast(page,15000)); }
if(action==='dep'){ await clickBtn(page,'^Элэгдэл бодох$'); await page.waitForTimeout(1000); log('dlg',await dlgText(page)); log('toast',await toast(page,15000)); }
if(action==='close'){ const b=page.getByRole('button',{name:/Тайлант үе хаах|Сар хаах|Хаах$/}).last(); log('close btn',await b.count(), await b.isEnabled().catch(()=>null)); if(await b.count()&&await b.isEnabled()){ await b.click(); await page.waitForTimeout(900); log('dlg',await dlgText(page)); const d=page.locator('[role=dialog],[role=alertdialog]').last(); const names=await d.locator('button').allInnerTexts().catch(()=>[]); const bi=names.findIndex(x=>x.trim()==='Болих'); if(bi>=0) await d.locator('button').nth(bi+1).click(); log('toast',await toast(page,15000)); } }
await page.waitForTimeout(800); log('page',(await page.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,1600));
await shot(page,'d-close-'+action); flush(); await browser.close();
