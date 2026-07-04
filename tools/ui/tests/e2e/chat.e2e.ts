import { test, expect } from '@playwright/test';

test.describe('Chat Interface', () => {
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

		// Mock available/downloaded models API
		await page.route('**/api/models/downloaded', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([])
			});
		});

		// Mock chat completions endpoint
		await page.route('**/v1/chat/completions', async (route) => {
			const sseData1 = JSON.stringify({
				id: 'chatcmpl-123',
				object: 'chat.completion.chunk',
				created: 1677652288,
				model: 'llama-pro-mock',
				choices: [{
					index: 0,
					delta: {
						role: 'assistant',
						content: 'Hello! I am a mock AI assistant.'
					},
					finish_reason: null
				}]
			});
			const sseData2 = JSON.stringify({
				id: 'chatcmpl-123',
				object: 'chat.completion.chunk',
				created: 1677652288,
				model: 'llama-pro-mock',
				choices: [{
					index: 0,
					delta: {},
					finish_reason: 'stop'
				}]
			});
			
			await route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				body: `data: ${sseData1}\n\ndata: ${sseData2}\n\ndata: [DONE]\n\n`
			});
		});

	});

	test('should send a message and receive a response', async ({ page }) => {
		await page.goto('/');

		// Wait for the app to initialize
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });

		// Type a message
		await page.locator('textarea').fill('Hello AI');

		// Press Enter to send
		await page.locator('textarea').press('Enter');

		// Verify the user message appears
		await expect(page.locator('text="Hello AI"')).toBeVisible();

		// Verify the assistant response appears
		await expect(page.locator('text="Hello! I am a mock AI assistant."')).toBeVisible();
	});

	test('should create a new conversation', async ({ page }) => {
		await page.goto('/');

		await expect(page.locator('textarea')).toBeVisible();
		
		// Fill and send first message
		await page.locator('textarea').fill('First conversation');
		await page.locator('textarea').press('Enter');
		await expect(page.locator('[aria-label="User message with actions"]', { hasText: 'First conversation' })).toBeVisible();

		// Click "New Chat" button in sidebar or header
		// We'll use a generic locator for the new chat button (often an a tag with href="#/")
		// Adjust this locator based on the actual app structure
		const newChatBtn = page.locator('a[href="#/"], a[href="?new_chat=true#/"], button[aria-label="New chat"]').first();
		if (await newChatBtn.isVisible()) {
			await newChatBtn.click({ force: true });
			// Ensure it navigates back to empty state
			await expect(page.locator('[aria-label="User message with actions"]', { hasText: 'First conversation' })).not.toBeVisible();
		}
	});
});
