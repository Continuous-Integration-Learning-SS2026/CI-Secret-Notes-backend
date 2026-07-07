// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Feature A + B - create and unlock an encrypted note', () => {
  test('creating a note never exposes plaintext content in the notes list', async ({ page }) => {
    const uniqueTitle = `E2E Note ${Date.now()}`;
    const secretContent = 'This plaintext must never appear outside the unlock flow.';
    const unlockKey = 'e2e-test-key-123';

    await page.goto('/');

    await page.getByPlaceholder(/title/i).fill(uniqueTitle);
    await page.getByPlaceholder(/content|note|message/i).fill(secretContent);
    await page.getByPlaceholder(/key|password|passphrase/i).first().fill(unlockKey);
    await page.getByRole('button', { name: /save|create|add/i }).click();

    await expect(page.getByText(uniqueTitle)).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(secretContent);
  });

  test('unlocking with the correct key reveals the original plaintext', async ({ page }) => {
    const uniqueTitle = `E2E Unlock ${Date.now()}`;
    const secretContent = 'Only the correct key should reveal this.';
    const unlockKey = 'correct-e2e-key';

    await page.goto('/');
    await page.getByPlaceholder(/title/i).fill(uniqueTitle);
    await page.getByPlaceholder(/content|note|message/i).fill(secretContent);
    await page.getByPlaceholder(/key|password|passphrase/i).first().fill(unlockKey);
    await page.getByRole('button', { name: /save|create|add/i }).click();

    await page.getByText(uniqueTitle).click();
    await page.getByPlaceholder(/key|password|passphrase/i).last().fill(unlockKey);
    await page.getByRole('button', { name: /unlock|view|decrypt/i }).click();

    await expect(page.getByText(secretContent)).toBeVisible();
  });

  test('unlocking with the wrong key is rejected', async ({ page }) => {
    const uniqueTitle = `E2E WrongKey ${Date.now()}`;
    const secretContent = 'Wrong key must not unlock this note.';

    await page.goto('/');
    await page.getByPlaceholder(/title/i).fill(uniqueTitle);
    await page.getByPlaceholder(/content|note|message/i).fill(secretContent);
    await page.getByPlaceholder(/key|password|passphrase/i).first().fill('right-key');
    await page.getByRole('button', { name: /save|create|add/i }).click();

    await page.getByText(uniqueTitle).click();
    await page.getByPlaceholder(/key|password|passphrase/i).last().fill('wrong-key');
    await page.getByRole('button', { name: /unlock|view|decrypt/i }).click();

    await expect(page.getByText(/invalid key|incorrect|denied|error/i)).toBeVisible();
    await expect(page.getByText(secretContent)).not.toBeVisible();
  });
});

test.describe('Feature C - PostHog-driven A/B UI toggle', () => {
  test('the app renders one of the two known UI variants without erroring', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByPlaceholder(/title/i)).toBeVisible();
    expect(consoleErrors, `Console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
  });
});