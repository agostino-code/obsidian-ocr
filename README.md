# Obsidian OCR

Obsidian OCR is an Obsidian plugin that extracts formulas from images and pastes them directly into your notes.

## What It Does

- Converts formulas from image files to LaTeX-style text.
- Reads images from the clipboard and replaces a temporary placeholder directly in the editor.
- Supports two backends:
	- Local OCR with Ollama (recommended for privacy and offline workflows).
	- Remote OCR with Hugging Face Inference Providers (configured for `zai-org/GLM-OCR`).

## Backend Options

### Local (Ollama)

1. Install Ollama from https://ollama.com/
2. Pull your OCR model (example):

```bash
ollama pull glm-ocr
```

3. In plugin settings configure:
	 - Ollama command/path (default `ollama`)
	 - Ollama host (default `http://127.0.0.1`)
	 - Ollama port (default `11434`)
	 - Ollama model (default `glm-ocr`)

### Remote (Hugging Face)

1. Create an access token at https://huggingface.co/settings/tokens
2. Paste it in plugin settings
3. The plugin uses `zai-org/GLM-OCR` through Hugging Face Inference Providers

## Commands

- Paste formula from clipboard image
- (Re)start local OCR service
- Stop local OCR service

## License

This project is distributed under GPLv3 (or later). See the LICENSE file for details.

## Upstream Acknowledgement

This plugin started from the excellent work in the original project:

- https://github.com/lucasvanmol/obsidian-latex-ocr

That codebase was a fundamental contribution and made this fork possible.

The current fork evolves the architecture around modern OCR backends (Ollama and Hugging Face provider-based OCR) while keeping the core user experience in Obsidian.
