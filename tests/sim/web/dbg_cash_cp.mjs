import {open,shot,flush,BASE} from '../common/harness.mjs';
import {fill,clickBtn,dlgText} from './d_lib.mjs';
const {browser,page}=await open({height:1400});
await page.goto(BASE+'/cash/transactions',{waitUntil:'networkidle'}); await page.waitForTimeout(700);
await clickBtn(page,'^Шинэ гүйлгээ$'); await page.waitForTimeout(700);
const d=page.locator('[role=dialog]').last();
await d.getByRole('button',{name:/Бүртгэлээс сонгох/}).first().click(); await page.waitForTimeout(500);
const portal=page.locator('[data-searchable-portal]').last(); const pi=portal.locator('input').first(); if(await pi.count()){ await pi.fill('Номин'); await page.waitForTimeout(500); }
await portal.locator('button').filter({hasText:'Номин'}).first().click(); await page.waitForTimeout(800);
const el=d.locator('label').filter({hasText:'Авлагын нэхэмжлэлээс'}).first().locator('xpath=following::*[1]');
console.log('next el',await el.evaluate(e=>e.outerHTML.slice(0,300)));
await el.click(); await page.waitForTimeout(700);
console.log('options',JSON.stringify(await page.getByRole('option').allInnerTexts()));
console.log('listbox',JSON.stringify(await page.locator('[role=listbox], [data-searchable-portal], [data-slot=select-content]').allInnerTexts()).slice(0,400));
await shot(page,'dbg-cash-inv'); flush(); await browser.close();
