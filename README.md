# VLMs OCR for Obsidian

[![GitHub release](https://img.shields.io/github/v/release/agostino-code/obsidian-ocr?color=blue)](https://github.com/agostino-code/obsidian-ocr/releases)
[![Obsidian Downloads](https://img.shields.io/badge/Obsidian-Community%20Plugins-483699?logo=obsidian&logoColor=white)](https://obsidian.md/plugins?id=vlm-ocr)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Local & Private](https://img.shields.io/badge/Privacy-100%25%20Local%20Available-success)](#run-locally-with-llamacpp-recommended-for-low-vram)

**VLMs OCR** turns Obsidian into an intelligent multimodal transcription workspace. Extract text, LaTeX mathematical formulas, and tables from images and PDFs, or generate in-depth structured descriptions of charts, plots, and diagrams—completely offline using local Vision-Language Models (VLMs) or in the cloud.

Powered locally by high-efficiency VLMs like [GLM-OCR (0.9B)](https://huggingface.co/zai-org/GLM-OCR) or any vision model via **llama.cpp** / **Ollama**, as well as the **Hugging Face Inference API**.

---

## ✨ Features

- 🧠 **Auto-detect & Intelligent OCR Modes**:
  - **Auto-detect**: Intelligently classifies content and outputs formatted Markdown, inline/display LaTeX, or converts charts and diagrams into rich textual explanations.
  - **Describe Image / Chart**: Generates structured markdown summaries of graphs, plots, architectures, workflows, and infographics.
  - **Full Document**: Converts book pages, slides, papers, and scanned notes into clean Markdown.
  - **Formulas Only**: Formats math expressions directly into Obsidian-compatible LaTeX (`$$...$$` and `$ ... $`).
  - **Tables**: Parses complex tabular data into pristine Markdown tables.
  - **Plain Text & Custom Prompt**: Extract unformatted text or provide your own instruction prompt.
- ⚡ **Optimized for Low-VRAM Hardware (MX450 / 2GB–4GB GPUs)**:
  - Smart automatic downscaling preserves aspect ratio while preventing token explosion and out-of-memory errors.
  - Zero-temp-file in-memory clipboard pipeline processes images directly from RAM.
  - One-click *Low-VRAM Preset* configures context window and memory limits automatically.
- 📋 **Seamless Workflow & Hotkeys**:
  - **Paste image directly as OCR**: Press `Ctrl+Alt+V` (configurable) to grab an image from your clipboard and immediately insert transcribed Markdown/LaTeX at your cursor.
  - **Non-blocking inline preview**: Real-time markdown placeholder (`<!-- [OCR is being generated...] -->`) keeps your editor responsive while the model runs.
  - **Context Menu & Ribbon**: Right-click any image or PDF in your file explorer to transcribe or describe it.
- 🔒 **100% Local & Private or Zero-Install Cloud**:
  - **llama.cpp**: Native, blazing-fast GGUF execution with optional GPU offloading.
  - **Ollama**: Connects to your local Ollama instance with auto-start support.
  - **Hugging Face API**: Free cloud inference with zero local dependencies or GPU requirements.

---

## 🚀 Quick Start

### Option A: Cloud Inference (Zero-Install, No GPU Required)

1. Create a free account at [huggingface.co](https://huggingface.co).
2. Generate a `read` token in [Hugging Face Token Settings](https://huggingface.co/settings/tokens).
3. In Obsidian, go to **Settings → VLMs OCR**:
   - Turn off **Use local model**.
   - Paste your token into the **API Key** field.

---

### Option B: Run Locally with llama.cpp (Recommended for Speed & Low VRAM)

Running GLM-OCR locally in GGUF format requires **less than 1.2 GB of VRAM**, making it ideal even for entry-level GPUs (like the NVIDIA GeForce MX450 / GTX 1650) or pure CPU execution.

1. **Obtain llama-server**:
   - Download the latest `llama.cpp` release with your preferred acceleration (CUDA or CPU) from [llama.cpp Releases](https://github.com/ggml-org/llama.cpp/releases).
2. **Download GLM-OCR GGUF weights**:
   - Model: [GLM-OCR.Q4_K_M.gguf](https://huggingface.co/mradermacher/GLM-OCR-GGUF) (~530 MB)
   - Multimodal projector: [GLM-OCR.mmproj-Q8_0.gguf](https://huggingface.co/mradermacher/GLM-OCR-GGUF) (~484 MB)
3. **Configure Settings**:
   - In Obsidian, go to **Settings → VLMs OCR**.
   - Enable **Use local model** and choose **Local backend: llama.cpp**.
   - Set **llama.cpp executable path** to your `llama-server.exe` (or `llama-server` on Linux/macOS).
   - Click **Apply Low-VRAM preset** or set arguments:
     ```text
     -m "/path/to/GLM-OCR.Q4_K_M.gguf" --mmproj "/path/to/GLM-OCR.mmproj-Q8_0.gguf" -ngl 99 -c 4096 --host 127.0.0.1 --port 8080
     ```

---

### Option C: Run Locally with Ollama

1. Install [Ollama](https://ollama.com/download).
2. Pull your desired vision model (e.g., `ollama pull glm-ocr` or `ollama pull minicpm-v`).
3. In Obsidian **Settings → VLMs OCR**:
   - Enable **Use local model** and select **Local backend: Ollama**.
   - Enter your model name in **Ollama model**.

---

## ⌨️ How to Use

### 1. Clipboard Paste (Fastest)
1. Copy any screenshot, math formula, or document snippet to your clipboard (`Win + Shift + S` on Windows, `Cmd + Shift + 4` on macOS).
2. In your Obsidian note, run the command **"OCR image from clipboard"** (or bind it to `Ctrl+Alt+V`).
3. The recognized Markdown or LaTeX expression will appear right at your cursor position!

### 2. Vault Files
- Right-click any supported image (`.png`, `.jpg`, `.webp`, `.bmp`, `.gif`) or `.pdf` in the file explorer.
- Select **Perform OCR (Auto / Active mode)** to copy the text to your clipboard, or **Describe Image / Chart** for an analytical breakdown.

---

## ⚙️ Configuration Reference

| Setting | Description | Default |
|---|---|---|
| **OCR mode** | Choose default parsing behavior (`Auto-detect`, `Describe`, `Document`, `Formulas`, `Tables`, `Text`, `Custom`) | `Auto-detect` |
| **Max image dimension** | Proportional image downscaling threshold to conserve VRAM (set `1536` for 2GB GPUs, `0` to disable) | `1536` |
| **In-memory clipboard** | Process clipboard captures entirely in memory without writing temporary files to disk | `Enabled` |
| **Show status bar** | Displays live backend status indicators (Ready ✅, Loading ⚙️, Offline ❌) | `Enabled` |

---

## 🛠️ Requirements & Compatibility

- **Obsidian**: v1.4.0 or newer.
- **Operating Systems**: Windows, macOS, Linux (Desktop only).
- **Supported File Types**: PNG, JPG, JPEG, WEBP, BMP, GIF, PDF.

---

## 🔒 Security & Disclosures

In accordance with the [Obsidian Developer Policies](https://docs.obsidian.md/community-directory/developer-policies):

- **Desktop Only (`isDesktopOnly: true`)**: This plugin is strictly for desktop platforms because local Vision-Language Model execution requires native binary execution and filesystem access.
- **Shell Execution (`child_process`)**:
  - Used exclusively to spawn and manage the local inference servers chosen and configured by the user (`llama-server.exe` or `ollama`).
  - The plugin does **not** execute arbitrary shell commands. It only spawns the configured local server executable with inference parameters (such as `--port`, `-m`, `--mmproj`, `-c`).
- **Filesystem Access (`fs`)**:
  - **Local Model Files**: Reads user-selected local model weights (`.gguf` files) and local server executables configured in settings.
  - **Vault Files & Images**: Reads user-selected image and PDF files from the vault or file picker to convert them into base64 visual inputs for OCR processing.
  - No system files outside the configured paths and selected attachments are modified or deleted.
- **Network Use**:
  - **Local Mode (Default)**: Connects strictly to `localhost` / `127.0.0.1` (to the local `llama-server` or Ollama HTTP REST API). Zero data leaves your computer.
  - **Cloud Mode (Optional)**: If and only if the user explicitly switches the backend to Hugging Face API, image data is transmitted directly over HTTPS to Hugging Face Inference API using the user-provided API key.

---

## 📄 License & Attribution

- Released under the [GNU General Public License v3.0 (GPL-3.0)](LICENSE).
- Based on and inspired by the original [obsidian-latex-ocr](https://github.com/lucasvanmol/obsidian-latex-ocr) by [lucasvanmol](https://github.com/lucasvanmol).
- Model architecture powered by [GLM-OCR](https://huggingface.co/zai-org/GLM-OCR) by the Zhipu AI & GLM research team.
