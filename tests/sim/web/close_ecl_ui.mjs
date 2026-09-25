// Сар хаалтын wizard-ийн ECL алхам (5) — статус, «ECL тооцох» товч + screenshot.
// node web/close_ecl_ui.mjs <YYYY-MM> [tag]
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, ym, tag='close-ecl']=process.argv;
const {browser,page}=await open({height:2200});
await setPeriod(page,ym);
await page.goto(BASE+'/close',{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
const step=()=>page.locator('div').filter({hasText:/^5Авлагын ECL нөөц|Авлагын ECL нөөц \(IFRS 9\)/}).last();
await shot(page,`${tag}-before`);
console.log('before', (await step().innerText()).replace(/\n+/g,' | '));
await page.getByRole('button',{name:/^ECL тооцох$/}).click();
for(let i=0;i<20;i++){ await page.waitForTimeout(700); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} }
await page.waitForTimeout(2000);
await shot(page,`${tag}-after`);
console.log('after', (await step().innerText()).replace(/\n+/g,' | '));
flush(); await browser.close();
