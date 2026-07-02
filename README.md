<div align="center">

# LLaMA Pro - Distributed Ai Engine 2.0.2
*by Dynamo.llc*

**The ultimate desktop wrapper and Distributed AI Engine built on top of `llama.cpp`**

</div>

Welcome to **LLaMA Pro**. We've taken the robust foundation of raw C/C++ LLM inference and wrapped it into a sleek, feature-rich desktop application designed for power users, developers, and AI enthusiasts.

## ✨ Major Features

- **Local LoRA Training:** Fine-tune models directly on your machine without needing external cloud services.
- **Compute Pool:** Utilize a decentralized peer-to-peer network to distribute compute loads seamlessly.
- **Real-time Telemetry:** Monitor hardware usage and system performance at a glance.
- **Advanced Prompt Engineering Controls:** Tweak generation parameters, system prompts, and formatting on the fly.
- **Stunning UI with Multiple Themes:** Enjoy a rich, responsive interface with multiple aesthetic options—including our brand new **Dark City Neon Cyberpunk Hacker Console** theme!
- **Cross-Platform Assisted Installer:** Easy-to-use installation with options for custom directories and automatic desktop/start menu shortcuts.

## 🚀 Getting Started

### Installation

1. Navigate to the [Releases](https://github.com/dynamo-llc/LLaMA-Pro/releases) page.
2. Download the latest `LLaMA-Pro-Setup.exe` (Version 2.0.2).
3. Run the installer. You'll be prompted to choose your preferred installation directory.
4. Launch **LLaMA Pro** from your Desktop or Start Menu shortcut.

### Using the App

Once installed, simply open the application. You can load your favorite `.gguf` models, connect to the peer-to-peer compute pool, or jump straight into the settings to switch on the Cyberpunk theme.

## 🛠️ Build from Source

If you prefer to build the application from source, follow these steps:

1. Clone this repository.
2. Ensure you have `Node.js` and `npm` installed.
3. Build the UI frontend:
   ```bash
   cd tools/ui
   npm install
   npm run build
   ```
4. Build the Electron Desktop application:
   ```bash
   cd ../desktop
   npm install
   npx electron-builder --win nsis
   ```

---

### Acknowledgements

*This project is powered by [llama.cpp](https://github.com/ggml-org/llama.cpp). The original upstream documentation can be found in `README-llama.cpp.md`.*
