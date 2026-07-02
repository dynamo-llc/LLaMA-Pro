# Local LoRA Training

LLaMA Pro isn't just for running models—it also supports fine-tuning them! Using Low-Rank Adaptation (LoRA), you can train existing open-source models on your own datasets directly on your local hardware.

## Why Local LoRA?

- **Privacy:** Fine-tune models on highly sensitive or proprietary data without ever uploading it to a cloud provider.
- **Cost:** Avoid expensive cloud GPU rental fees.
- **Efficiency:** LoRA only trains a small set of injected weights, meaning you can fine-tune large models (like 8B or 13B parameter models) on a single consumer GPU (like an RTX 3090 or 4090).

## Prerequisites for Training

- A base model in `.gguf` format.
- A compatible GPU with sufficient VRAM (typically 12GB+ for a 7B/8B model, 24GB+ for larger models).
- A dataset formatted as a plain text file (`.txt`) or a JSONL file containing your training examples.

## How to Start a Training Job

1. **Navigate to the Training Tab:** In the LLaMA Pro UI, look for the LoRA/Training section.
2. **Select Base Model:** Choose the base `.gguf` model you want to adapt.
3. **Upload Dataset:** Provide the path to your training data file.
4. **Configure Hyperparameters:**
   - **LoRA Rank (r):** Determines the expressiveness of the adaptation. Higher rank = better learning capacity but higher VRAM usage. (Default: 8 or 16).
   - **LoRA Alpha:** Scaling factor. Usually set to 2x or 1x the rank.
   - **Batch Size:** Number of examples processed at once. Lower this if you run out of VRAM (OOM).
   - **Context Size:** The maximum sequence length during training.
5. **Start Training:** Click **Start**. You can monitor the loss curve in real-time on the Telemetry dashboard.

## Applying Your Trained LoRA

Once training completes, it will output a `lora-adapter.gguf` file. 

To use it:
1. Go to the **Models** page.
2. Select your original base model.
3. In the model loading settings, specify the path to your new `lora-adapter.gguf` file.
4. Load the model. The engine will merge your custom weights on the fly!
