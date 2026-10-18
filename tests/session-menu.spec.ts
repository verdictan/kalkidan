import {test,expect} from '@playwright/test';
async function openSession(page:any){await page.goto('http://127.0.0.1:5173');await page.getByRole('button',{name:'Atlas 3',exact:true}).click();await page.locator('.repo-select').first().click();await page.getByRole('button',{name:'Resume session',exact:true}).first().click();}
test('conversation actions rename, pin, fork, and open an independent side chat',async({page})=>{
 await openSession(page);
 const menu=()=>page.getByRole('button',{name:'Conversation actions',exact:true}).click();
 await menu();await page.screenshot({animations:'disabled',path:'test-results/conversation-actions.png'});
 await page.getByRole('menuitem',{name:/^Rename/}).click();await page.getByLabel('Conversation name').fill('Release review');await page.getByRole('button',{name:'Save name'}).click();await expect(page.locator('.conversation-header')).toContainText('Release review');
 await menu();await page.getByRole('menuitem',{name:/^Pin/}).click();await expect(page.locator('.session-metadata').getByLabel('Pinned')).toBeVisible();
 await menu();await page.getByRole('menuitem',{name:'Fork',exact:true}).hover();await page.getByRole('menuitem',{name:'In current checkout'}).click();await expect(page.locator('.conversation-header:visible')).toContainText('Fork of Release review');
 await menu();await page.getByRole('menuitem',{name:/New side chat/}).click();await expect(page.getByLabel('Message agent')).toHaveCount(3);await expect(page.getByRole('button',{name:'Close side chat'})).toBeVisible();await page.screenshot({animations:'disabled',path:'test-results/side-chat.png'});await page.getByRole('button',{name:'Close side chat'}).click();await expect(page.getByRole('button',{name:'Close side chat'})).toHaveCount(0);
});
test('scheduling dialog explains app-open execution and validates required inputs',async({page})=>{
 await openSession(page);await page.getByRole('button',{name:'Conversation actions'}).click();await page.getByRole('menuitem',{name:'Add scheduled task…'}).click();await expect(page.getByRole('dialog')).toContainText('Missed runs wait for you');await expect(page.getByRole('button',{name:'Schedule task',exact:true})).toBeDisabled();await page.getByLabel('Scheduled task prompt').fill('Review outstanding work');await page.getByLabel('Run at').fill('2027-01-01T10:00');await page.getByRole('button',{name:'Schedule task',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Open the desktop app');
});
