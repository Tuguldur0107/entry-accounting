import {open,shot,flush,BASE} from '../common/harness.mjs';
const seg=process.argv[2]||'8';
const {browser,page}=await open();
await page.goto(BASE+`/settings/gl?tab=values&seg=${seg}`,{waitUntil:'networkidle'}); await page.waitForTimeout(800);
const b=page.getByRole('button',{name:/Стандарт утга татах/}); console.log('btn',await b.count());
if(await b.count()){ await b.first().click(); await page.waitForTimeout(3000); const d=page.locator('[role=dialog],[role=alertdialog]'); if(await d.count()){ console.log('dlg',(await d.last().innerText()).slice(0,200)); const cb=d.last().getByRole('button').filter({hasText:/Татах|Нэмэх|Батлах|OK/}); if(await cb.count()) await cb.last().click(); await page.waitForTimeout(3000);} }
const rows=await page.locator('.ag-center-cols-container .ag-row').allInnerTexts(); console.log(rows.length, JSON.stringify(rows.slice(0,3)));
await shot(page,`seg${seg}-seeded`);
flush(); await browser.close();
