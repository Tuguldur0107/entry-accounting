import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, ym, tag]=process.argv;
const {browser,page}=await open();
await setPeriod(page,ym);
await page.goto(BASE+'/fa/depreciation',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
const b=page.getByRole('button',{name:/GL-д батлах/}); console.log('btn',await b.count(), await b.first().innerText().catch(()=>''));
if(await b.count()){ await b.first().click(); await page.waitForTimeout(800);
  const d=page.locator('[role=dialog],[role=alertdialog]').last(); if(await d.count()){ console.log('dlg',(await d.innerText()).slice(0,200).replace(/\n/g,' ')); const cb=d.getByRole('button').filter({hasText:/Батлах|GL-д/}).last(); if(await cb.count()) await cb.click(); }
  for(let i=0;i<30;i++){ await page.waitForTimeout(1000); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} } }
await shot(page,tag||'fa-post');
flush(); await browser.close();
