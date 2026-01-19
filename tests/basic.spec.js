// @ts-check
const { test, expect } = require('@playwright/test');

test('basic app interactions', async ({ page }) => {
    // 1. App Launch
    await page.goto('/');
    await expect(page).toHaveTitle(/WordLetta/);

    // 2. New Game Modal - Verify it appears on launch
    // The modal has a header "New WordLetta"
    const newGameModal = page.locator('text=New WordLetta');
    await expect(newGameModal).toBeVisible();

    // 3. Navigation - Close New Game modal
    // targeting the close button inside the modal
    const closeButton = page.locator('button', { hasText: '×' }).first();
    await closeButton.click();
    await expect(newGameModal).not.toBeVisible();

    // 4. Navigation - Open Settings
    const settingsButton = page.locator('button[title="Settings"]');
    await settingsButton.click();

    // 5. Verify Settings modal appears
    // The settings modal header
    const settingsHeader = page.locator('h5', { hasText: 'Settings' });
    await expect(settingsHeader).toBeVisible();
});
