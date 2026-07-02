# Installation Guide

Welcome! This guide will walk you through installing **LLaMA Pro - Distributed AI Engine** on your Windows system using the pre-compiled installer.

## System Requirements

- **OS:** Windows 10 or Windows 11 (64-bit)
- **RAM:** Minimum 8GB (16GB+ recommended for larger models)
- **GPU:** Optional but highly recommended for hardware acceleration. NVIDIA (CUDA), AMD (ROCm/Vulkan), and Intel GPUs are supported.
- **Storage:** ~500MB for the application, plus additional space for your `.gguf` model files (varies significantly based on model size, usually 3GB - 40GB+).

## Using the Setup Executable

We've bundled the entire application (UI frontend + C++ backend) into a single installer for maximum convenience.

1. **Download the Installer:**
   Navigate to the [Releases](https://github.com/dynamo-llc/LLaMA-Pro/releases) page on our GitHub repository. Download the latest `LLaMA-Pro-Setup.exe` (Version 2.0.2 or higher).

2. **Run the Installer:**
   Double click the `.exe` file. Depending on your Windows SmartScreen settings, you may need to click "More info" -> "Run anyway".

3. **Select Installation Directory:**
   You will be prompted to choose an installation directory. The default is usually `C:\Program Files\LLaMA Pro\`.

4. **Shortcuts:**
   The installer will automatically create a Start Menu entry and an optional Desktop shortcut for easy access.

## Post-Installation Setup

Once installed, simply double-click the **LLaMA Pro** desktop icon to launch the application.

- **Downloading Models:** By default, you'll need `.gguf` models to run locally. You can download these from platforms like HuggingFace.
- **Connecting to the Router:** If you don't have local models, you can launch the app and navigate to the **Models** tab to connect to online APIs using our dynamic router system.

## Troubleshooting

- **File Not Found Errors on Launch:** Ensure that your antivirus hasn't quarantined the `llama-server.exe` backend process.
- **Blank Screen / UI not loading:** Try restarting the application. The Electron frontend depends on the local backend server starting up correctly on port 8080.

If you prefer to compile everything yourself, check out the [Building from Source](Building-from-Source) guide!
