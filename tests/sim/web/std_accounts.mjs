import {open,shot,flush,BASE} from '../common/harness.mjs';
const {browser,page}=await open();
// Шинэ сайдбарын "Дансны төлөвлөгөө" линкээр
await page.goto(BASE+'/gl/journal',{waitUntil:'networkidle'});
const link=page.getByRole('link',{name:/Дансны төлөвлөгөө/}); console.log('link',await link.count(), link.count()?await link.first().getAttribute('href'):'');
if(await link.count()) await link.first().click(); else await page.goto(BASE+'/settings/gl?tab=values&seg=3');
await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
console.log('URL',page.url());
await shot(page,'03-coa');
const std=page.getByRole('button',{name:/Стандарт данс/}); console.log('std btn',await std.count(), await page.getByRole('button').allInnerTexts().then(a=>a.filter(x=>x.trim()).slice(0,20)));
if(await std.count()){ await std.first().click(); await page.waitForTimeout(6000); await shot(page,'04-coa-after'); }
const txt=await page.locator('body').innerText(); console.log(txt.match(/\d+ данс/g)?.slice(0,3));
flush(); await browser.close();
