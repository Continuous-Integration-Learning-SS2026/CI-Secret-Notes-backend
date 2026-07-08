// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Feature A + B - create and unlock an encrypted note', () => {
  test('creating a note never exposes plaintext content in the notes list', async ({ page }) => {
    const uniqueTitle = `E2E Note ${Date.now()}`;
    const secretContent = 'This plaintext must never appear outside the unlock flow.';
    const unlockKey = 'e2e-test-key-123';

    await page.goto('/');

    await page.locator('#note-title').fill(uniqueTitle);
    await page.locator('#note-content').fill(secretContent);
    await page.locator('#note-key').fill(unlockKey);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create New Note' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();

    await expect(page.getByText(uniqueTitle)).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(secretContent);
  });

  test('unlocking with the correct key reveals the original plaintext', async ({ page }) => {
    const uniqueTitle = `E2E Unlock ${Date.now()}`;
    const secretContent = 'Only the correct key should reveal this.';
    const unlockKey = 'correct-e2e-key';

    await page.goto('/');
    await page.locator('#note-title').fill(uniqueTitle);
    await page.locator('#note-content').fill(secretContent);
    await page.locator('#note-key').fill(unlockKey);
    await page.getByRole('button', { name: 'Create New Note' }).click();

    const noteArticle = page.locator('.note-item', { hasText: uniqueTitle });
    await noteArticle.locator('.unlock-input').fill(unlockKey);
    await noteArticle.locator('.decrypt-btn').click();

    await expect(noteArticle.locator('.decrypted-content p')).toHaveText(secretContent);
  });

  test('unlocking with the wrong key is rejected', async ({ page }) => {
    const uniqueTitle = `E2E WrongKey ${Date.now()}`;
    const secretContent = 'Wrong key must not unlock this note.';

    await page.goto('/');
    await page.locator('#note-title').fill(uniqueTitle);
    await page.locator('#note-content').fill(secretContent);
    await page.locator('#note-key').fill('right-key');
    await page.getByRole('button', { name: 'Create New Note' }).click();

    const noteArticle = page.locator('.note-item', { hasText: uniqueTitle });
    await noteArticle.locator('.unlock-input').fill('wrong-key');

    const [dialog] = await Promise.all([
      page.waitForEvent('dialog'),
      noteArticle.locator('.decrypt-btn').click(),
    ]);
    expect(dialog.message()).toContain('Invalid key');
    await dialog.dismiss();

    await expect(noteArticle.locator('.decrypted-content')).toBeHidden();
  });
});

test.describe('Feature C - PostHog-driven A/B UI toggle', () => {
  test('the app renders without erroring, regardless of assigned variant', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Core form must render regardless of which PostHog variant ('dark-note-theme'
    // feature flag) this session is assigned - the flag only toggles a CSS class
    // on the submit button, it never hides the form.
    await expect(page.locator('#note-title')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create New Note' })).toBeVisible();
    expect(consoleErrors, `Console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
  });
});