import { test, expect } from '@playwright/test';

test.describe('Models Page', () => {
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

		// Mock models endpoint
		await page.route('**/v1/models', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					data: [
						{
							id: 'llama-pro-mock',
							object: 'model',
							created: 1677610602,
							owned_by: 'llama-pro',
							model: 'llama-pro-mock',
							status: { value: 'loaded' }
						}
					]
				})
			});
		});

		// Mock downloaded models API
		await page.route('**/api/models/downloaded', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						id: 'llama-pro-mock',
						name: 'LLaMA Pro Mock',
						size: 4000000000,
						modified_at: '2023-11-01T12:00:00Z',
						details: {
							format: 'gguf',
							family: 'llama',
							parameter_size: '7B',
							quantization_level: 'Q4_K_M'
						}
					}
				])
			});
		});

		// Mock available models API (from registry/catalog)
		await page.route('**/api/models/available', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						id: 'new-model-available',
						name: 'New Awesome Model',
						description: 'A new model you can download',
						size: 8000000000
					}
				])
			});
		});
	});

	test('should display downloaded models', async ({ page }) => {
		await page.goto('/#/models');

		// Wait for the models page to load
		await expect(page.locator('h3', { hasText: 'Local Downloaded Models' }).first()).toBeVisible();

		// Check if our mocked model is visible in the list
		await expect(page.locator('text="llama-pro-mock"').first()).toBeVisible();
	});
});
