# Settings & Themes

Make LLaMA Pro your own! The **Settings** menu allows you to customize the application's behavior, performance, and aesthetics.

## Application Settings

### Default Paths
- **Model Directory:** Set the default folder where LLaMA Pro looks for `.gguf` files.
- **LoRA Directory:** Set the default folder for storing your trained adapters.

### Inference Defaults
You can set global defaults for prompt engineering parameters. These apply unless specifically overridden in a chat session.
- **System Prompt:** The default system instruction given to models.
- **Temperature / Top-P:** Control the creativity and randomness of the output.
- **Context Size (n_ctx):** The default context window size allocated in RAM.

## Visual Themes

We believe your workspace should look incredible. Navigate to **Settings > Appearance** to change the UI theme.

### Available Themes
- **Light Mode:** Clean, high-contrast, and professional.
- **Dark Mode:** A sleek, easy-on-the-eyes standard dark UI.
- **Dark City Neon Cyberpunk Hacker Console:** Our signature theme! Inspired by retro-futurism, this theme applies glowing neon accents, monospace terminal fonts, high-contrast black backgrounds, and subtle micro-animations that make you feel like you're hacking the mainframe.

> [!TIP]
> The UI is built using responsive CSS. If you're building from source, you can easily create your own themes by modifying the root CSS variables in `tools/ui/src/app.css`.
