import {open,shot,flush,BASE} from '../common/harness.mjs';
const seg=process.argv[2]||'8';
const {browser,page}=await open();
await page.goto(BASE+`/settings/gl?tab=values&seg=${seg}`,{waitUntil:'networkidle'}); await page.waitForTimeout(1000);
await shot(page,`seg${seg}`);
const rows=await page.locator('.ag-center-cols-container .ag-row').allInnerTexts(); console.log(rows.length, JSON.stringify(rows.slice(0,25)));
const t=await page.locator('body').innerText(); console.log(t.slice(t.indexOf('S8'),t.indexOf('S8')+300).replace(/\n/g,' | '));
flush(); await browser.close();
