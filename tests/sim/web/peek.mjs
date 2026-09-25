import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, path, ym, name]=process.argv;
const {browser,page}=await open();
if(ym) await setPeriod(page,ym);
await page.goto(BASE+path,{waitUntil:'networkidle'}); await page.waitForTimeout(1200);
await shot(page,name||'peek');
const btns=await page.getByRole('button').allInnerTexts(); console.log('buttons',JSON.stringify(btns.filter(x=>x.trim()).slice(0,40)));
const tabs=await page.getByRole('tab').allInnerTexts(); console.log('tabs',JSON.stringify(tabs));
flush(); await browser.close();
