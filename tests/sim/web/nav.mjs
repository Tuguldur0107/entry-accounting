import {open,shot,flush,BASE} from '../common/harness.mjs';
const {browser,page}=await open();
await page.goto(BASE+'/',{waitUntil:'networkidle'}).catch(()=>{}); await page.waitForTimeout(1500);
console.log('url',page.url());
const links=await page.locator('a').evaluateAll(a=>[...new Set(a.map(x=>x.getAttribute('href')))]);
console.log(JSON.stringify(links));
await shot(page,'nav'); flush(); await browser.close();
