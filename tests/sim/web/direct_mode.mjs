import {open,shot,flush,BASE} from '../common/harness.mjs';
const {browser,page}=await open();
await page.goto(BASE+'/ai',{waitUntil:'networkidle'});
await shot(page,'05-ai');
const direct=page.getByRole('radio',{name:/Шууд бичих/});
console.log('radio',await direct.count(), await page.getByRole('radio').allInnerTexts().catch(()=>[]));
if(await direct.count()){ await direct.first().click(); await page.waitForTimeout(1500); console.log('checked',await direct.first().getAttribute('aria-checked')); await shot(page,'06-ai-direct');}
else { const t=await page.locator('body').innerText(); console.log(t.slice(0,600)); }
flush(); await browser.close();
