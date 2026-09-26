// D хэрэглэгчээр C байгууллага руу шилжиж, бичих үйлдэл оролдох
import {open,shot,flush,BASE} from '../common/harness.mjs';
import {fill,clickBtn,toast,dlgText} from './d_lib.mjs';
const {browser,page}=await open({height:1300,slow:true});
const log=(...a)=>console.log(...a);
await page.goto(BASE+'/',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
await page.getByRole('button',{name:/SIM Микро ХХК/}).first().click(); await page.waitForTimeout(700);
log('switcher',JSON.stringify((await page.locator('[role=menu], [role=dialog], [data-slot=popover-content], [role=listbox]').last().innerText().catch(()=>'')).replace(/\n+/g,' | ').slice(0,300)));
const opt=page.getByRole('menuitem',{name:/SIM Импорт/}).or(page.getByRole('option',{name:/SIM Импорт/})).or(page.getByText('SIM Импорт ХХК',{exact:true})).first();
await opt.click(); await page.waitForTimeout(1500); log('url',page.url(), (await page.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,200));
await shot(page,'rbac-switch');
// бичих оролдлого: кассын гүйлгээ
await page.goto(BASE+'/cash/transactions',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
log('cash buttons',JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()).slice(7,14)));
const nb=page.getByRole('button',{name:/^Шинэ гүйлгээ$/}); log('new tx btn',await nb.count(), await nb.count()?await nb.isEnabled():null);
if(await nb.count() && await nb.isEnabled()){ await nb.click(); await page.waitForTimeout(700); const d=page.locator('[role=dialog]').last(); await d.getByRole('button',{name:/^Орлого$/}).click(); await fill(d,'Дүн',1000); await d.locator('select').first().selectOption({index:1}); const gl=d.locator('input[placeholder="GL данс..."]').first(); await gl.fill('51100000'); await page.keyboard.press('Tab'); await fill(d,'Журналын нэр','RBAC тест'); await d.getByRole('button',{name:/^Хадгалж батлах$/}).click(); log('write toast',await toast(page)); await shot(page,'rbac-write'); }
// журнал батлах / тохиргоо
await page.goto(BASE+'/settings/permissions',{waitUntil:'networkidle'}); await page.waitForTimeout(800); log('perm page',(await page.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,200));
await page.goto(BASE+'/settings/ai',{waitUntil:'networkidle'}); await page.waitForTimeout(800); log('ai settings',(await page.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,200));
flush(); await browser.close();
