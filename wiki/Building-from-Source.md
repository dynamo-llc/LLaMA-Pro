# Building from Source

If you're a developer, contributor, or just someone who prefers compiling their own software from scratch, you can easily build **LLaMA Pro** directly from the source code.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

1. **Git:** To clone the repository.
2. **Node.js & npm:** Required to build the SvelteKit frontend and Electron app wrapper. (v18+ recommended)
3. **CMake:** Required to build the C++ backend (`llama-server`).
4. **C++ Compiler:** 
   - *Windows:* Visual Studio Build Tools with MSVC and Windows SDK.
   - *Linux/Mac:* GCC or Clang.
5. **Python 3:** Required by some local scripts and dependencies.

## Step 1: Clone the Repository

Clone the project to your local machine:

```bash
git clone https://github.com/dynamo-llc/LLaMA-Pro.git
cd LLaMA-Pro
```

## Step 2: Build the C++ Backend (llama-server)

The heavy lifting of LLaMA Pro is handled by a modified `llama.cpp` server backend.

```bash
# Configure the build system
cmake -B build -S . -DCMAKE_BUILD_TYPE=Release

# Compile the server
cmake --build build --config Release --parallel
```

> [!TIP]
> If you have a dedicated GPU, you should add flags like `-DGGML_CUDA=ON` (for NVIDIA) or `-DGGML_VULKAN=ON` (for universal GPU support) during the `cmake -B build` step to enable hardware acceleration.

## Step 3: Build the UI Frontend

The user interface is a modern web application built with SvelteKit.

```bash
cd tools/ui
npm install
npm run build
```

This will compile the frontend assets into a static directory that the backend server or Electron wrapper can host.

## Step 4: Build the Desktop App (Electron)

To bundle the application into a standalone desktop executable:

```bash
# Assuming you are currently in tools/ui
cd ../desktop
npm install

# Build the Windows executable installer
npx electron-builder --win nsis
```

*Note: For macOS or Linux, replace `--win nsis` with `--mac` or `--linux` respectively.*

The resulting installer will be located in the `tools/desktop/dist/` directory.

## Development Mode

If you're making changes to the UI and want live-reloading:

1. Ensure the C++ backend is running in a separate terminal:
   ```bash
   ./build/bin/Release/llama-server.exe
   ```
2. Run the SvelteKit dev server:
   ```bash
   cd tools/ui
   npm run dev
   ```

Navigate to `http://localhost:5173` to see your changes in real-time!
