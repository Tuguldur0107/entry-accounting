import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, file, ym]=process.argv;
const {browser,page}=await open();
await setPeriod(page,ym);
await page.goto(BASE+'/gl/journal',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
await page.getByRole('button',{name:/Excel импорт/}).first().click(); await page.waitForTimeout(800);
await shot(page,'12-import-dialog');
const inp=page.locator('input[type=file]').first();
await inp.setInputFiles(file); await page.waitForTimeout(2500);
await shot(page,'13-import-preview');
const dlg=page.locator('[role=dialog]').last();
const txt=(await dlg.innerText()); console.log('preview', txt.slice(0,900).replace(/\n+/g,' | '));
const go=dlg.getByRole('button',{name:/зөв мөрийг оруулах/}); console.log('go',await go.count(), await go.innerText().catch(()=>''), await go.isDisabled().catch(()=>''));
if(await go.count() && !(await go.isDisabled())){ await go.click(); 
  for(let i=0;i<20;i++){ await page.waitForTimeout(1000); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} } }
await page.waitForTimeout(1500); await shot(page,'14-import-done');
flush(); await browser.close();
