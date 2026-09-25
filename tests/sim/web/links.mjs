import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, path, ym]=process.argv;
const {browser,page}=await open();
if(ym) await setPeriod(page,ym);
await page.goto(BASE+path,{waitUntil:'networkidle'}); await page.waitForTimeout(1200);
console.log(JSON.stringify([...new Set(await page.locator('a').evaluateAll(a=>a.map(x=>x.getAttribute('href'))))]));
console.log((await page.locator('main, body').first().innerText()).slice(0,1500).replace(/\n+/g,' | '));
flush(); await browser.close();
