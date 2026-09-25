import {open,shot,flush,BASE} from '../common/harness.mjs';
const {browser,page}=await open({height:1200});
await page.goto(BASE+'/gl/journal',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
await page.getByRole('button',{name:/2026 · 9-р сар/}).click(); await page.waitForTimeout(600);
const pop=page.locator('[role=dialog], [data-slot=popover-content], [role=menu], [role=listbox]').last();
console.log('items',JSON.stringify(await pop.locator('button, [role=option], [role=menuitem], [role=tab]').allInnerTexts()).slice(0,300));
await shot(page,'d-period');
flush(); await browser.close();
