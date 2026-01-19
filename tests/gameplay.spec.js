// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Endless Mode Gameplay', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // 1. Select 5-letter mode
        await page.locator('button', { hasText: '5' }).first().click();
        // 2. Click Play Endless Challenge
        await page.locator('button', { hasText: 'Play Endless Challenge' }).click();
        // 3. Verify Modal Closes
        await expect(page.locator('text=New WordLetta')).not.toBeVisible();

        // Wait for transition
        await page.waitForTimeout(1000);

        // Ensure focus is on the body/window so key events are captured
        await page.click('body');
    });

    test('Enter Valid Guess (Keyboard)', async ({ page }) => {
        // 1. Type Valid Word "APPLE" with delay between keystrokes
        await page.keyboard.type('APPLE', { delay: 100 });

        // Give Alpine a moment
        await page.waitForTimeout(200);

        // 2. Verify inputs are filled (wait for the last letter to ensure typing is done)
        const lastInput = page.locator('.row.guess .letter input').nth(4);
        await expect(lastInput).toHaveValue('E');

        // 3. Press Enter
        await page.keyboard.press('Enter');

        // Give Alpine a moment to process submission
        await page.waitForTimeout(500);

        // 4. Verify Guess Submitted
        // The previous guess letters appear in spans with class 'reveal'
        const revealed = page.locator('.reveal');
        await expect(revealed).toHaveCount(5);
        await expect(revealed.first()).toHaveText('A');
    });

    test('Handle Invalid Guess (Keyboard)', async ({ page }) => {
        // 1. Type Invalid Word "ZZZZZ"
        await page.keyboard.type('ZZZZZ', { delay: 100 });

        // Give Alpine a moment
        await page.waitForTimeout(200);

        // 2. Press Enter
        await page.keyboard.press('Enter');

        await page.waitForTimeout(500);

        // 3. Verify Guess NOT Submitted
        const revealed = page.locator('.reveal');
        await expect(revealed).toHaveCount(0);

        // 4. Verify Inputs still have text (not cleared)
        const firstInput = page.locator('.row.guess .letter input').nth(0);
        await expect(firstInput).toHaveValue('Z');
    });

    test('Timer Pauses when Modal Open', async ({ page }) => {
        // 1. Trigger Timer Start (Timer starts on first interaction)
        await page.keyboard.type('A');

        // VERIFY input was received
        const firstInput = page.locator('.row.guess .letter input').nth(0);
        await expect(firstInput).toHaveValue('A');

        // 2. Capture initial time
        const timer = page.locator('span[x-text="headerTime"]');
        await expect(timer).toBeVisible();

        // Wait until timer is at least 0:01
        await expect(async () => {
            const text = await timer.textContent();
            expect(text).not.toBe('0:00');
        }).toPass({ timeout: 5000 });

        const timeBeforePause = await timer.textContent();

        // 3. Open Settings Modal
        await page.locator('button[title="Settings"]').click({ force: true });
        // Wait for modal transition
        await page.waitForTimeout(1000);
        await expect(page.locator('text=Settings').first()).toBeVisible();

        // 4. Wait a few seconds
        await page.waitForTimeout(3000);

        // 5. Verify time has NOT changed
        const timeDuringPause = await timer.textContent();
        expect(timeDuringPause).toBe(timeBeforePause);

        // 6. Close Modal
        // Target the button inside the visible Settings modal
        const closeBtn = page.locator('div[x-show="showSettingsModal"] button').filter({ hasText: '×' });
        await expect(closeBtn).toBeVisible();
        await closeBtn.click({ force: true });

        await expect(page.locator('text=Settings').first()).not.toBeVisible();

        // Wait for modal close
        await page.waitForTimeout(1000);

        // 7. Wait a few seconds (timer should resume)
        await expect(async () => {
            const text = await timer.textContent();
            expect(text).not.toBe(timeDuringPause);
        }).toPass({ timeout: 5000 });
    });

});
