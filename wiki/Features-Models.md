# Models & Router Mode

LLaMA Pro gives you complete flexibility in how you run AI models. You can either run `.gguf` models purely locally using your own hardware, or you can use our advanced **Router Mode** to seamlessly connect to external online APIs while keeping the same interface.

## Local Mode (Worker Node)

By default, if you launch the engine by explicitly specifying a model file (e.g., passing a `--model path/to/model.gguf` argument to the backend), LLaMA Pro operates as a **Single-Model Worker Node**. 

- **Purely Local:** Everything runs on your machine. No data leaves your network.
- **Hardware Bound:** Inference speed depends entirely on your CPU/GPU hardware.
- **Limitation:** In this mode, you cannot dynamically load other models on the fly through the UI. You are bound to the model you launched with.

## Router Mode (Dynamic Loading)

If you launch LLaMA Pro without specifying a strict local model, it boots up in **Router Mode**. This is the recommended mode for most users.

In Router Mode, you can use the **Models** tab in the UI to dynamically manage which AI models are active.

### Loading Local Models Dynamically
1. Go to the **Models** page in the UI.
2. Ensure your local `.gguf` files are stored in the designated model cache directory (configurable in settings).
3. Select your model and click **Load**. The backend will instantly allocate VRAM/RAM and spin up the model.

### Using Online APIs ("Load to Slot")
If your local hardware isn't powerful enough for massive models, you can connect to external providers (like OpenAI, Anthropic, or external inference APIs).
1. Go to the **Models** page.
2. Select an online provider or custom API endpoint.
3. Click **Load to Slot...**.
4. The system will create a virtual slot for this model. Whenever you chat or prompt this slot, LLaMA Pro acts as a proxy, routing your request to the API seamlessly.

> [!NOTE]
> If you try to dynamically load a model while running as a Single-Model Worker Node, you will receive an error. Simply restart the application in Router Mode to regain this functionality.
