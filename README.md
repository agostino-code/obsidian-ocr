# Obsidian OCR

![GitHub release (with filter)](https://img.shields.io/github/v/release/agostino-code/obsidian-ocr)
[![Hugging Face](https://img.shields.io/badge/Hugging%20Face-FFD21E?logo=huggingface&logoColor=000)](#)
[![Ollama](https://img.shields.io/badge/Ollama-fff?logo=ollama&logoColor=000)](#)
[![Obsidian](https://img.shields.io/badge/Obsidian-%23483699.svg?&logo=obsidian&logoColor=white)](#)

Extract text, formulas, tables, and structured content from images directly into your Obsidian notes, powered by [GLM-OCR](https://huggingface.co/zai-org/GLM-OCR).

> This project is a fork of [obsidian-latex-ocr](https://github.com/lucasvanmol/obsidian-latex-ocr) by lucasvanmol. The original plugin focused exclusively on LaTeX formula recognition. **Obsidian OCR** extends this to full document OCR: any text, formula, table, or mixed content in an image can be extracted and inserted into your notes.

<img src="/images/demo.gif" width="50%"/>

## Features

- **Full OCR** — extract any text from images, not just LaTeX formulas.
- **Formula support** — mathematical expressions are recognized and output in LaTeX.
- **Paste from clipboard** — use a custom command (e.g. `Ctrl+Alt+V`) to OCR an image from your clipboard and insert the result directly.
- **Context menu** — right-click any image in your vault and choose "Generate OCR text".
- **Two backends** — use the [Hugging Face API](#using-the-hugging-face-api) for a zero-install cloud option, or [run locally with Ollama](#run-locally-with-ollama) for full offline use.

---

## Using the Hugging Face API

The plugin can use the [GLM-OCR model](https://huggingface.co/zai-org/GLM-OCR) via the Hugging Face Inference API (free tier).

### Setup

1. Create an account or log in at [huggingface.co](https://huggingface.co).
2. Generate a `read` access token in your [Hugging Face profile settings](https://huggingface.co/settings/tokens). Creating one dedicated to this plugin is recommended.
3. In Obsidian, open **Settings → Obsidian OCR** and paste the token into the **API Key** field.

### Limitations

- The free Inference API may take a few seconds to provision the model on the first request. Subsequent requests are faster.
- Rate limits apply on the free tier. If you hit them, wait a moment and retry.
- For heavy usage, consider running the model locally with Ollama (see below).

---

## Run Locally with Ollama

You can run GLM-OCR entirely on your machine using [Ollama](https://ollama.com). No internet connection or API key required after the initial model download.

### Requirements

- [Ollama](https://ollama.com/download) installed and available in your PATH (or at a custom path you configure).
- A vision-capable GLM-OCR model available in your Ollama instance.

### Installation

**1. Install Ollama**

Download and install from [ollama.com/download](https://ollama.com/download), then verify:

```bash
ollama --version
```

**2. Pull the GLM-OCR model**

```bash
ollama pull glm-ocr
```

> The model is approximately 1–2 GB. The download happens once and is cached locally.

You can verify it is available with:

```bash
ollama list
```

**3. Configure the plugin**

In Obsidian, open **Settings → Obsidian OCR**:

- Enable **Use local model**.
- Set **Ollama command/path** — usually just `ollama` if it is in your PATH, or the full path to the binary.
- Set **Ollama host** — default is `http://127.0.0.1`.
- Set **Ollama port** — default is `11434`.
- Set **Ollama model** — enter the model name exactly as shown by `ollama list`, e.g. `glm-ocr`.
- Press **(Re)start Ollama** to launch the server, then **Check Status** to confirm it is ready.

### GPU Support

Ollama automatically uses your GPU if supported. To verify:

```bash
ollama run glm-ocr "test"
```

If you want to explicitly check CUDA availability, see the [Ollama GPU documentation](https://github.com/ollama/ollama/blob/main/docs/gpu.md).

### Status Bar

The status bar at the bottom of Obsidian shows the current state of the backend:

| Status | Meaning |
|---|---|
| OCR ✅ | Ready |
| OCR ⚙️ | Loading / warming up |
| OCR 🌐 | Model being provisioned (API) |
| OCR 🔧 | Needs configuration |
| OCR ❌ | Unreachable |

---

## Attribution

- Forked from [obsidian-latex-ocr](https://github.com/lucasvanmol/obsidian-latex-ocr) by [lucasvanmol](https://github.com/lucasvanmol).
- OCR powered by [GLM-OCR](https://huggingface.co/zai-org/GLM-OCR) by [zai-org](https://github.com/zai-org).
