const fs = require('fs');

const logPath = `C:\\Users\\MONSTER\\.gemini\\antigravity\\brain\\40dd3dde-aab1-40da-b6d8-f71eafd03999\\.system_generated\\logs\\transcript_full.jsonl`;
const lines = fs.readFileSync(logPath, 'utf-8').split('\n');

for (const line of lines) {
    if (!line.trim()) continue;
    try {
        const obj = JSON.parse(line);
        if (obj.tool_calls) {
            for (const call of obj.tool_calls) {
                if (call.function && call.function.name === 'default_api:write_to_file') {
                    const args = JSON.parse(call.function.arguments);
                    if (args.TargetFile && args.TargetFile.includes('CompanionOverlay.svelte')) {
                        fs.writeFileSync('CompanionOverlay.svelte.backup', args.CodeContent);
                        console.log("Recovered CompanionOverlay.svelte to CompanionOverlay.svelte.backup");
                    }
                }
            }
        }
    } catch (e) {}
}
