import {open,shot,flush,BASE} from '../common/harness.mjs';
import {fill,toast,dlgText} from './d_lib.mjs';
const {browser,page}=await open({height:1400,slow:true});
await page.goto(BASE+'/admin/org',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
await page.getByRole('button',{name:/^Байгууллага устгах$/}).click(); await page.waitForTimeout(900);
const d=page.locator('[role=dialog],[role=alertdialog]').last(); const txt=(await d.innerText().catch(()=>'')).replace(/\n+/g,' | '); console.log('dlg',txt.slice(0,600));
console.log('fields',JSON.stringify(await d.locator('input').evaluateAll(a=>a.map(x=>x.placeholder||x.type))));
await shot(page,'d-org-delete-dlg');
const inp=d.locator('input').first();
if(await inp.count()){ const want=(txt.match(/«([^»]+)»/)||[])[1]||'SIM Микро ХХК'; await inp.fill(want); await page.waitForTimeout(400); }
const names=await d.locator('button').allInnerTexts(); console.log('btns',JSON.stringify(names));
const del=d.getByRole('button',{name:/Бүрмөсөн устгах/}).first(); console.log('del count',await del.count(),'enabled',await del.isEnabled().catch(()=>null));
await del.click({force:true}); console.log('toast',await toast(page,15000)); await page.waitForTimeout(2000); console.log('url',page.url(), (await page.locator('body').innerText()).replace(/\n+/g,' | ').slice(0,300));
await shot(page,'d-org-deleted'); flush(); await browser.close();
