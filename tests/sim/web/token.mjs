import {open,shot,flush,BASE,ODIR} from '../common/harness.mjs';
import fs from 'fs'; import path from 'path';
const {browser,page}=await open();
await page.goto(BASE+'/settings/ai',{waitUntil:'networkidle'});
for (const name of ['MCP холболт','MCP']) { const el=page.getByRole('tab',{name}); if(await el.count()){await el.first().click(); break;} const b=page.getByRole('button',{name}); if(await b.count()){await b.first().click();break;} }
await page.waitForTimeout(800);
await page.locator('#mcp-token-name').fill('SIM2 '+(process.env.SIM_ORG||''));
await page.getByRole('button',{name:'Token үүсгэх'}).click();
const code=page.locator('code').filter({hasText:/^eak_/}).first();
await code.waitFor({timeout:20000});
fs.writeFileSync(path.join(ODIR,'.token'),(await code.innerText()).trim()); console.log('token ok');
await shot(page,'02-token');
flush(); await browser.close();
