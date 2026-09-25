// D · алхам 4-6: агуулах, бараа ×15, ажилтан ×2, ҮХ ×1 (вэб-only)
import {open,shot,flush,BASE} from '../common/harness.mjs';
import {fill,clickBtn,toast,dlgText,pickSearchable} from './d_lib.mjs';
const {browser,page}=await open({height:1800,slow:true});
const log=(...a)=>console.log(...a);
const only=(process.argv[2]||'wh,items,emp,fa').split(',');
if(only.includes('wh')){
  await page.goto(BASE+'/inventory/warehouses',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
  await clickBtn(page,'нэмэх|Агуулах'); await page.waitForTimeout(700);
  const d=page.locator('[role=dialog]').last(); await fill(d,'Код','AG-01'); await fill(d,'Нэр','Дэлгүүр (үндсэн)');
  await d.getByRole('button',{name:/^Хадгалах$/}).click(); log('wh:',await toast(page)); await shot(page,'d4-warehouse');
}
const ITEMS=[['BM-001','Кофе 250г',18000],['BM-002','Цай 100г',9000],['BM-003','Элсэн чихэр 1кг',4500],['BM-004','Гурил 1кг',3200],['BM-005','Будаа 1кг',5800],['BM-006','Ургамлын тос 1л',9500],['BM-007','Сүү 1л',4200],['BM-008','Талх',2800],['BM-009','Өндөг 10ш',7500],['BM-010','Давс 1кг',1500],['BM-011','Жигнэмэг',3500],['BM-012','Ундаа 1.5л',3800],['BM-013','Ус 0.5л',1200],['BM-014','Шоколад',4800],['BM-015','Угаалгын нунтаг 1кг',12000]];
if(only.includes('items')){
  for(const [code,nm,pr] of ITEMS){
    await page.goto(BASE+'/inventory/items',{waitUntil:'networkidle'}); await page.waitForTimeout(700);
    await clickBtn(page,'^Бараа нэмэх$'); await page.waitForTimeout(700);
    const d=page.locator('[role=dialog]').last(); await fill(d,'Код',code); await fill(d,'Нэр',nm); await fill(d,'Борлуулах үнэ',pr);
    await d.getByRole('button',{name:/^Хадгалах$/}).click(); log('item',code,':',await toast(page));
  }
  await shot(page,'d5-items');
}
if(only.includes('emp')){
  for(const [ln,fn,reg,pos,sal] of [['Дорж','Батбаяр','УБ90010101','Захирал',2500000],['Бат','Сарнай','УБ92020202','Худалдагч',1400000]]){
    await page.goto(BASE+'/payroll/employees',{waitUntil:'networkidle'}); await page.waitForTimeout(700);
    await clickBtn(page,'нэмэх|Ажилтан'); await page.waitForTimeout(700);
    const d=page.locator('[role=dialog]').last(); await fill(d,'Овог',ln); await fill(d,'Нэр',fn); await fill(d,'Регистрийн дугаар',reg); await fill(d,'Албан тушаал',pos); await fill(d,'Ажилд орсон огноо','2026-09-01'); await fill(d,'Банк','Хаан банк'); await fill(d,'Дансны дугаар','5040001122'); await fill(d,'Үндсэн цалин',sal);
    await d.getByRole('button',{name:/^Хадгалах$/}).click(); log('emp',fn,':',await toast(page));
  }
  await shot(page,'d6-employees');
}
if(only.includes('fa')){
  await page.goto(BASE+'/fa/assets',{waitUntil:'networkidle'}); await page.waitForTimeout(700);
  await clickBtn(page,'^Шинэ хөрөнгө$'); await page.waitForTimeout(700);
  const d=page.locator('[role=dialog]').last(); await fill(d,'Нэр','Хөргөгч витрин'); await fill(d,'Эзэмшигч','Сарнай'); await fill(d,'Байршил','Дэлгүүр'); await fill(d,'Авсан огноо','2026-09-05'); await fill(d,'Өртөг (MNT)',4800000); await fill(d,'Ашиглалтын хугацаа',60); await fill(d,'Элэгдэл эхлэх сар','2026-10');
  await d.getByRole('button',{name:/^Бүртгэх$/}).click(); log('fa:',await toast(page)); await shot(page,'d7-fa');
}
flush(); await browser.close();
