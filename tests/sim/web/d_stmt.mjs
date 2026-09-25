// D · банкны хуулга импорт (жишээ CSV татаж форматыг үзээд, өөрийн CSV оруулах)
import {open,shot,flush,BASE,ODIR} from '../common/harness.mjs';
import path from 'path';
import {fill,clickBtn,toast,dlgText} from './d_lib.mjs';
import fs from 'fs';
const {browser,page}=await open({height:1600,slow:true});
const log=(...a)=>console.log(...a);
await page.goto(BASE+'/cash/statements',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
// жишээ CSV
const [dl]=await Promise.all([page.waitForEvent('download',{timeout:15000}).catch(()=>null), page.getByRole('link',{name:/Жишээ CSV/}).or(page.getByRole('button',{name:/Жишээ CSV/})).first().click()]);
if(dl){ const p=path.join(ODIR,'sample.csv'); await dl.saveAs(p); log('sample:',fs.readFileSync(p,'utf8').slice(0,600)); }
else log('no download');
await shot(page,'d-stmt-1'); flush(); await browser.close();
