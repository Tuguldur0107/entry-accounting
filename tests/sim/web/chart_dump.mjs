import {open,flush,BASE} from '../common/harness.mjs';
const {browser,page}=await open({height:3000});
await page.goto(BASE+'/settings/gl?tab=values&seg=3',{waitUntil:'networkidle'}); await page.waitForTimeout(1200);
// бүх бүлгийг задлах
for(const t of ['2X','3X','4X','5X','6X','7X','8X','9X']){ const b=page.getByRole('button',{name:new RegExp('^'+t+'$')}).first(); if(await b.count()) { await b.click().catch(()=>{}); await page.waitForTimeout(300);} }
const txt=await page.locator('main, body').first().innerText();
const codes=[...new Set(txt.match(/\b[1-9]\d{7}\b/g)||[])];
console.log(codes.length, JSON.stringify(codes.filter(c=>/^[5-8]/.test(c))));
const m=txt.match(/7\d{7}[^\n]*\n[^\n]*/g); console.log(JSON.stringify((m||[]).slice(0,30)));
flush(); await browser.close();
