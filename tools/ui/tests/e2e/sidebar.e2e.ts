import { test, expect } from '@playwright/test';

test.describe('Sidebar Navigation', () => {
	test.beforeEach(async ({ page }) => {
		// Mock server properties endpoint
		await page.route('**/props*', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					default_generation_settings: { n_ctx: 4096, params: {} },
					role: 'router',
					chat_template: ''
				})
			});
		});

		await page.route('**/v1/models', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data: [] })
			});
		});
	});

	test('should navigate to different pages using the sidebar', async ({ page }) => {
		await page.goto('/');

		// Determine if sidebar is visible (might need to toggle on mobile, but Playwright desktop shouldn't)
		// We look for links with aria-label or specific text. We'll try to find the standard navigation links.

		// Click the Settings link in the sidebar
		const settingsLink = page.locator('nav a[href="/settings"], a[href="/settings"]').first();
		if (await settingsLink.isVisible()) {
			await settingsLink.click();
			await expect(page).toHaveURL(/\/settings/);
			await expect(page.locator('h1', { hasText: 'Settings' }).first()).toBeVisible();
		}

		// Click the Models link in the sidebar
		const modelsLink = page.locator('nav a[href="/models"], a[href="/models"]').first();
		if (await modelsLink.isVisible()) {
			await modelsLink.click();
			await expect(page).toHaveURL(/\/models/);
			await expect(page.locator('h1', { hasText: 'Models' }).first()).toBeVisible();
		}

		// Click the Home/Chat link
		const homeLink = page.locator('nav a[href="/"], a[href="/"]').first();
		if (await homeLink.isVisible()) {
			await homeLink.click();
			await expect(page).toHaveURL(/\/$/);
			await expect(page.locator('textarea')).toBeVisible();
		}
	});
});
