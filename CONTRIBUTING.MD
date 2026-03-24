# Developer Information

## About this fork

**Obsidian OCR** is a fork of [obsidian-latex-ocr](https://github.com/lucasvanmol/obsidian-latex-ocr). The original plugin was purpose-built for LaTeX formula extraction using the `nougat-latex-ocr` model and a Python gRPC sidecar server. This fork replaces that architecture with [GLM-OCR](https://huggingface.co/zai-org/GLM-OCR), a general-purpose document OCR model, and removes the Python sidecar dependency entirely.

**Key differences from the original:**

- **Goal**: full document OCR (text, formulas, tables, mixed content), not LaTeX-only.
- **Backend options**: Hugging Face Inference API or Ollama (local). The Python `latex-ocr-server` gRPC sidecar is no longer used.
- **Model**: GLM-OCR (`zai-org/GLM-OCR`) instead of `nougat-latex-ocr`.
- **Output**: plain extracted text with inline LaTeX where formulas are detected, wrapped in the configured delimiters.

---

## Architecture

The plugin has two model backends, both implementing the `Model` interface (`models/model.ts`):

- **`models/online_model.ts`** — sends images to the Hugging Face Inference API (`api-inference.huggingface.co`) using the GLM-OCR model. The API key is stored via Obsidian's `safeStorage` when encryption is available.
- **`models/local_model.ts`** — communicates with a locally running [Ollama](https://ollama.com) instance via its HTTP API (`/api/chat`). Supports auto-start of the Ollama process from within Obsidian.

Settings and UI are in `settings.ts`. The active backend is selected via the "Use local model" toggle in the settings tab.

---

## Getting started

1. Install [NodeJS](https://nodejs.org/).
2. Clone the repository and run:
   ```bash
   npm install
   ```
3. Start the development build watcher:
   ```bash
   npm run dev
   ```
4. Copy the plugin folder into your Obsidian vault's `.obsidian/plugins/` directory (or symlink it).
5. Enable the plugin in Obsidian's Community Plugins settings.
6. Use the [Hot Reload plugin](https://github.com/pjeby/hot-reload) to avoid manual restarts during development.

For updates to the Obsidian API:
```bash
npm update
```

---

## ESLint

Install ESLint globally if not already present:

```bash
npm install -g eslint
```

Lint the project:

```bash
eslint main.ts
# or for all source files:
eslint .\src\
```

---

## API Documentation

- Obsidian API: [https://github.com/obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api)
- GLM-OCR on Hugging Face: [https://huggingface.co/zai-org/GLM-OCR](https://huggingface.co/zai-org/GLM-OCR)
- Ollama API reference: [https://github.com/ollama/ollama/blob/main/docs/api.md](https://github.com/ollama/ollama/blob/main/docs/api.md)

---

## Releasing

1. Update `manifest.json` with the new version number and minimum Obsidian version.
2. Update `versions.json`:
   ```json
   "1.0.1": "1.4.0"
   ```
3. Tag and push:
   ```bash
   git tag -a 1.0.1 -m "1.0.1"
   git push origin 1.0.1
   ```
4. The release workflow will create the GitHub release automatically.

> You can use `npm version patch`, `npm version minor`, or `npm version major` to bump versions in `manifest.json` and `package.json` automatically, after manually updating `minAppVersion` in `manifest.json`.