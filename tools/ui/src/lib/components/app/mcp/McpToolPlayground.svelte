<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { Loader2, Play, Wrench } from '@lucide/svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';

	interface Props {
		open: boolean;
		toolName: string;
		serverName: string;
		schema?: any; // The inputSchema of the tool
		onOpenChange?: (open: boolean) => void;
	}

	let { open = $bindable(), toolName, serverName, schema, onOpenChange }: Props = $props();

	let inputJson = $state<string>('{}');
	let isExecuting = $state(false);
	let result = $state<string | null>(null);
	let error = $state<string | null>(null);

	let useDynamicForm = $state(false);
	let formValues = $state<Record<string, any>>({});
	let formSchema = $state<Record<string, any>>({});

	// Try to prepopulate inputJson with a default structure based on schema
	$effect(() => {
		if (open && schema && schema.properties) {
			const defaults: Record<string, any> = {};
			for (const [key, prop] of Object.entries(schema.properties)) {
				const p = prop as any;
				if (p.type === 'string') defaults[key] = '';
				else if (p.type === 'number' || p.type === 'integer') defaults[key] = 0;
				else if (p.type === 'boolean') defaults[key] = false;
				else if (p.type === 'array') defaults[key] = [];
				else if (p.type === 'object') defaults[key] = {};
				else defaults[key] = null;
			}
			inputJson = JSON.stringify(defaults, null, 2);
			
			// Simple check for dynamic form: only primitives
			useDynamicForm = Object.values(schema.properties).every((p: any) => 
				['string', 'number', 'integer', 'boolean'].includes(p.type)
			);
			
			if (useDynamicForm) {
				formValues = { ...defaults };
				formSchema = schema.properties;
			}
			
			result = null;
			error = null;
		} else if (open) {
			inputJson = '{}';
			useDynamicForm = false;
			result = null;
			error = null;
		}
	});

	async function handleExecute() {
		isExecuting = true;
		error = null;
		result = null;
		
		let parsedArgs = {};
		try {
			if (useDynamicForm) {
				parsedArgs = { ...formValues };
			} else if (inputJson.trim()) {
				parsedArgs = JSON.parse(inputJson);
			}
		} catch (e) {
			error = 'Invalid JSON input format';
			isExecuting = false;
			return;
		}

		try {
			const response = await mcpStore.executeToolByName(toolName, parsedArgs);
			// response is ToolExecutionResult. Format it.
			result = JSON.stringify(response, null, 2);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown execution error';
		} finally {
			isExecuting = false;
		}
	}

	function handleOpenChange(value: boolean) {
		open = value;
		onOpenChange?.(value);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-3xl max-h-[85vh] flex flex-col">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Wrench class="w-5 h-5 text-primary" />
				Test Tool: <span class="text-primary font-mono bg-primary/10 px-1 rounded">{toolName}</span>
			</Dialog.Title>
		</Dialog.Header>

		<div class="flex flex-col md:flex-row gap-4 mt-2 flex-grow min-h-0">
			<!-- Input Panel -->
			<div class="flex-1 flex flex-col gap-2 min-w-[50%]">
				<div class="flex items-center justify-between">
					<label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Arguments</label>
					{#if useDynamicForm}
						<button 
							class="text-[10px] text-blue-500 hover:underline" 
							onclick={() => { 
								useDynamicForm = false; 
								inputJson = JSON.stringify(formValues, null, 2); 
							}}
						>
							Edit Raw JSON
						</button>
					{/if}
				</div>

				{#if useDynamicForm}
					<div class="flex-1 overflow-y-auto space-y-3 p-1">
						{#each Object.entries(formSchema) as [key, prop]}
							<div class="space-y-1">
								<Label class="text-xs">{key} {#if schema?.required?.includes(key)}<span class="text-destructive">*</span>{/if}</Label>
								{#if prop.type === 'boolean'}
									<div class="flex items-center space-x-2 mt-1">
										<Checkbox bind:checked={formValues[key]} disabled={isExecuting} />
										<span class="text-xs text-muted-foreground">{prop.description || 'Enable'}</span>
									</div>
								{:else if prop.type === 'number' || prop.type === 'integer'}
									<Input type="number" bind:value={formValues[key]} disabled={isExecuting} placeholder={prop.description} class="h-8 text-xs" />
								{:else}
									<Input type="text" bind:value={formValues[key]} disabled={isExecuting} placeholder={prop.description} class="h-8 text-xs" />
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<Textarea 
						bind:value={inputJson} 
						class="font-mono text-sm h-full min-h-[150px] resize-none bg-background font-medium"
						placeholder={'{\n  "key": "value"\n}'}
						disabled={isExecuting}
					/>
				{/if}
				
				<Button class="w-full mt-2" onclick={handleExecute} disabled={isExecuting}>
					{#if isExecuting}
						<Loader2 class="w-4 h-4 mr-2 animate-spin" />
						Executing...
					{:else}
						<Play class="w-4 h-4 mr-2" />
						Run Tool
					{/if}
				</Button>
			</div>

			<!-- Output Panel -->
			<div class="flex-1 flex flex-col gap-2">
				<label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Response</label>
				<div class="flex-grow bg-black rounded-md border border-border p-3 overflow-auto relative h-[250px] md:h-full">
					{#if error}
						<div class="text-destructive font-mono text-sm">{error}</div>
					{:else if result}
						<pre class="text-green-400 font-mono text-xs whitespace-pre-wrap break-all">{result}</pre>
					{:else}
						<div class="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground opacity-50">
							<Play class="w-8 h-8 mb-2" />
							<p class="text-sm">Click Run Tool to see output</p>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<Dialog.Footer class="mt-4">
			<Button variant="secondary" onclick={() => handleOpenChange(false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
