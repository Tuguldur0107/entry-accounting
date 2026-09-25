// node web/post_arap_all.mjs <receivables|payables> <YYYY-MM> <tag> — жагсаалтын ноорог мөр бүрийн "Батлах" товч
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,,mod,ym,tag]=process.argv;
const {browser,page}=await open({height:3200});
await setPeriod(page,ym);
let n=0;
for(let round=0;round<60;round++){
  await page.goto(BASE+`/${mod}/documents`,{waitUntil:'networkidle'}); await page.waitForTimeout(700);
  const btn=page.getByRole('button',{name:/^Батлах$/}).first();
  if(!(await btn.count())) break;
  await btn.scrollIntoViewIfNeeded(); await btn.click(); await page.waitForTimeout(600);
  const d=page.locator('[role=alertdialog], [role=dialog]').last();
  const txt=(await d.innerText().catch(()=>'')).replace(/\n/g,' ').slice(0,160);
  const cb=d.getByRole('button',{name:/^Батлах|GL-д бичих/}).last(); if(await cb.count()) await cb.click();
  let toast='';
  for(let i=0;i<15;i++){ await page.waitForTimeout(700); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){toast=t.join('|');break;} }
  console.log(`#${++n}`, txt, '→', toast);
  if(/алдаа|Алдаа/.test(toast)) { await shot(page,`${tag}-err${n}`); if(n>50) break; }
}
await shot(page,tag); console.log('posted',n);
flush(); await browser.close();
