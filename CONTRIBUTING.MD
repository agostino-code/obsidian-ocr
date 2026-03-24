# Developer Information

## Project Overview

Obsidian OCR is an independent Obsidian plugin fork focused on OCR for formulas and general text from images.

Current OCR backends:

1. Local backend through Ollama.
2. Remote backend through Hugging Face Inference Providers.

## Getting Started

1. Install Node.js.
2. Install dependencies:

```bash
npm install
```

3. Build in watch mode:

```bash
npm run dev
```

4. Load the plugin in Obsidian from your local vault plugin directory.

## Development Notes

- Source code lives under `src/`.
- Main entrypoint is `src/main.ts`.
- Rebuilds are handled by esbuild config.
- For Obsidian API updates use:

```bash
npm update
```

## API Documentation

- https://github.com/obsidianmd/obsidian-api

## Releases

1. Update `manifest.json` version and `minAppVersion`.
2. Update `versions.json` with the new compatibility entry.
3. Tag and push:

```bash
git tag -a 1.0.1 -m "1.0.1"
git push origin 1.0.1
```

## Upstream Acknowledgement

This fork is built on top of foundational work from:

- https://github.com/lucasvanmol/obsidian-latex-ocr

That project was a key contribution and enabled this independent evolution.

