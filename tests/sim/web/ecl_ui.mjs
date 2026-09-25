// ENT-065: ECL хуудас — ААНОАТ-ын хувь тохируулах + screenshot.
// node web/ecl_ui.mjs <YYYY-MM> <taxRatePct> [tag]
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, ym, rate, tag='ecl']=process.argv;
const {browser,page}=await open({height:1300});
await setPeriod(page,ym);
await page.goto(BASE+'/receivables/ecl',{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
await shot(page,`${tag}-before`);
console.log('page', (await page.locator('main, body').first().innerText()).replace(/\n+/g,' | ').slice(0,700));
await page.getByRole('button',{name:/Тохиргоо/}).first().click(); await page.waitForTimeout(800);
const d=page.locator('[role=dialog]').last();
const rateInput=d.locator('input[type=number]').last(); // ААНОАТ-ын хувь — диалогийн сүүлийн тоон талбар
await rateInput.fill(String(rate));
await shot(page,`${tag}-settings`);
await d.getByRole('button',{name:/^Хадгалах$/}).click();
for(let i=0;i<20;i++){ await page.waitForTimeout(700); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} }
await page.waitForTimeout(1500);
await shot(page,`${tag}-after`);
console.log('after', (await page.locator('main, body').first().innerText()).replace(/\n+/g,' | ').slice(0,700));
flush(); await browser.close();
