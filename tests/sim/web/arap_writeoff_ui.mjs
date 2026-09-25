// ENT-065: АР нэхэмжлэлийн панель — хасалтын хэсэг + «Сэргэлт» диалогоор сэргээх.
// node web/arap_writeoff_ui.mjs <AR-NO> <YYYY-MM> <recoverAmount|-> [tag]
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, no, ym, amount, tag='writeoff']=process.argv;
const {browser,page}=await open({height:1600});
await setPeriod(page,ym);
await page.goto(BASE+'/receivables',{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
// Хасагдсан нэхэмжлэл «төлөгдсөн» тул нээлттэйн жагсаалтад байхгүй — Ctrl+K палитраар дугаараар нээнэ.
await page.keyboard.press('Control+k'); await page.waitForTimeout(600);
await page.getByPlaceholder(/баримт хайх/).fill(no); await page.waitForTimeout(1800);
await page.keyboard.press('Enter'); await page.waitForTimeout(2200);
const section=page.getByText('Найдваргүй авлага',{exact:true}).first();
await section.scrollIntoViewIfNeeded().catch(()=>{});
console.log('section', (await section.locator('xpath=../..').innerText().catch(()=>'-')).replace(/\n+/g,' | ').slice(0,500));
await shot(page,`${tag}-panel`);
if(amount && amount!=='-'){
  await page.getByRole('button',{name:/^Сэргэлт$/}).first().click(); await page.waitForTimeout(700);
  const d=page.locator('[role=dialog]').filter({hasText:/сэргэлт|хасах/i}).last(); // Next dev overlay нь мөн role=dialog
  await d.locator('input[type=number]').fill(String(amount));
  await shot(page,`${tag}-recover-dialog`);
  await d.getByRole('button',{name:/^Сэргээх$/}).click();
  for(let i=0;i<20;i++){ await page.waitForTimeout(700); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} }
  const err=await d.locator('.text-\\[var\\(--ea-danger-fg\\)\\]').allInnerTexts().catch(()=>[]); if(err.length) console.log('dialog-error',JSON.stringify(err));
  await page.waitForTimeout(1500);
  await shot(page,`${tag}-recovered`);
  console.log('after', (await section.locator('xpath=../..').innerText().catch(()=>'-')).replace(/\n+/g,' | ').slice(0,500));
}
flush(); await browser.close();
