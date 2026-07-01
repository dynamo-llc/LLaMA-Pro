import { serverStore } from './server.svelte';
import { modelsStore } from './models.svelte';

class SessionTelemetryStore {
	latestSpeed = $state<number>(0);
	latestPromptSpeed = $state<number>(0);

	// Map of model name -> array of completions timings
	// Each timing has { predicted_n: number, predicted_ms: number, prompt_n: number, prompt_ms: number }
	private modelTimings = $state<
		Record<
			string,
			{ predicted_n: number; predicted_ms: number; prompt_n: number; prompt_ms: number }[]
		>
	>({});

	private resolveModelName(modelName?: string | null): string {
		return (
			modelName ||
			modelsStore.selectedModelName ||
			serverStore.props?.default_generation_settings?.model ||
			'default'
		);
	}

	addTiming(
		modelName: string | null | undefined,
		predicted_n: number,
		predicted_ms: number,
		prompt_n?: number,
		prompt_ms?: number
	) {
		const name = this.resolveModelName(modelName);
		if (!predicted_n || !predicted_ms) return;
		if (!this.modelTimings[name]) {
			this.modelTimings[name] = [];
		}
		this.modelTimings[name].push({
			predicted_n,
			predicted_ms,
			prompt_n: prompt_n || 0,
			prompt_ms: prompt_ms || 0
		});
		this.latestSpeed = (predicted_n / predicted_ms) * 1000;
		if (prompt_n && prompt_ms) {
			this.latestPromptSpeed = (prompt_n / prompt_ms) * 1000;
		}
	}

	getAverageSpeed(modelName?: string | null): number {
		const name = this.resolveModelName(modelName);
		const timings = this.modelTimings[name];
		if (!timings || timings.length === 0) {
			return 0;
		}
		let totalTokens = 0;
		let totalMs = 0;
		for (const t of timings) {
			totalTokens += t.predicted_n;
			totalMs += t.predicted_ms;
		}
		return totalMs > 0 ? (totalTokens / totalMs) * 1000 : 0;
	}

	getAveragePromptSpeed(modelName?: string | null): number {
		const name = this.resolveModelName(modelName);
		const timings = this.modelTimings[name];
		if (!timings || timings.length === 0) {
			return 0;
		}
		let totalTokens = 0;
		let totalMs = 0;
		for (const t of timings) {
			totalTokens += t.prompt_n;
			totalMs += t.prompt_ms;
		}
		return totalMs > 0 ? (totalTokens / totalMs) * 1000 : 0;
	}
}

export const sessionTelemetryStore = new SessionTelemetryStore();
