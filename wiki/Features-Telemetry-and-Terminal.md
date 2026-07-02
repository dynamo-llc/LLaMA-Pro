# Telemetry & Terminal

For power users who want deep insight and control over their inference engine, LLaMA Pro includes a real-time Telemetry Dashboard and an integrated Command Line Terminal.

## Telemetry Dashboard

The **Telemetry Dashboard** provides real-time, visual metrics of your system and inference engine. It replaces the need to constantly monitor external task managers.

### Key Metrics Tracked
- **Tokens Per Second (t/s):** The raw speed at which the model is generating text.
- **Prompt Evaluation Speed:** How fast the engine processes the input context.
- **VRAM/RAM Usage:** Live monitoring of your GPU and System memory allocation.
- **Compute Pool Network Traffic:** If using the Compute Pool, you can monitor the RPC data transfer rates between nodes.
- **Hardware Temperatures:** (Where supported) GPU and CPU temperature monitoring to prevent thermal throttling.

## Integrated Terminal

While the GUI covers 95% of use cases, sometimes you need to get under the hood. The **Integrated Terminal** provides direct access to the `llama-server` standard output and input streams.

### What can you do with the Terminal?
- **View Raw Logs:** See the underlying C++ backend logs in real-time. This is invaluable for debugging model loading errors or Compute Pool connection issues.
- **Manual Commands:** Advanced users can issue direct HTTP curl requests or management commands to the local server without leaving the app.
- **Server Restarts:** Safely kill and restart the backend server process if it hangs, without closing the entire application.
