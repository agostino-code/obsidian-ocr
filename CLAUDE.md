# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- `npm run dev` - Start development build with watch mode and inline sourcemaps
- `npm run build` - Production build with TypeScript type checking and bundling
- `npm run lint` - Run ESLint on source files
- `npm run lint:fix` - Run ESLint with auto-fix

### Testing
No automated tests are currently present in this codebase.

## Architecture Overview

This is an Obsidian plugin that provides OCR (Optical Character Recognition) capabilities for extracting text, formulas, and structured content from images and PDFs. The plugin supports two backend modes:

1. **Cloud API** - Uses Hugging Face's GLM-OCR model via their Inference API
2. **Local Backend** - Runs OCR locally using either Ollama or llama.cpp

### Core Components

**Model Interface Pattern** (`src/models/model.ts`)
- Abstract interface that both `ApiModel` and `LocalModel` implement
- Defines lifecycle methods: `load()`, `start()`, `unload()`, `status()`
- Core OCR operation: `imgfileToLatex(filepath)` - extracts text/LaTeX from image/PDF files
- Settings reload: `reloadSettings(settings)` - updates model configuration

**Online Model** (`src/models/online_model.ts`)
- Implements Hugging Face API integration
- Uses the GLM-OCR model via their layout parsing API
- Handles API key encryption/decryption using Electron's safeStorage
- Supports JPG, PNG, and PDF files
- Status checks validate API key via `/api/whoami-v2` endpoint

**Local Model** (`src/models/local_model.ts`)
- Implements local OCR using Ollama or llama.cpp backends
- Auto-starts backend processes if not running
- Handles PDF rendering using PDF.js (converts pages to images before OCR)
- Supports retry logic for failed OCR requests (3 attempts with 5s delay)
- File type detection using magic bytes for extension-less files
- Status checks verify backend installation and model availability

**Main Plugin** (`src/main.ts`)
- Orchestrates model selection based on `useLocalModel` setting
- Registers Obsidian commands and context menu items
- Manages clipboard image processing
- Handles temporary file storage for pasted images
- Coordinates status bar updates

**Settings UI** (`src/settings.ts`)
- Provides Obsidian settings tab for configuration
- Manages API key input with encryption
- Controls local backend settings (paths, hosts, ports, models)
- Provides backend control buttons (check status, start/stop)
- Debounces settings saves (250ms delay)

**Status Bar** (`src/status_bar.ts`)
- Displays backend status with emoji indicators
- Polls model status at configurable intervals
- Shows: ✅ Ready / ⚙️ Loading / 🌐 Downloading / 🔧 Misconfigured / ❌ Unreachable

**Modal** (`src/modal.ts`)
- Provides UI for selecting files and running OCR
- Shows image preview for supported formats
- Displays OCR results with copy functionality

### Key Patterns

**Backend Selection**
The plugin dynamically instantiates either `LocalModel` or `ApiModel` based on the `useLocalModel` setting. This happens in `main.ts` during plugin load and when settings change.

**Process Management**
Local backends are spawned as child processes using Node.js `spawn()`. The plugin tracks process PIDs and handles cleanup on unload. Backend processes are started automatically on first OCR operation if unreachable.

**PDF Handling**
PDFs are processed by rendering each page to a canvas using PDF.js, then converting to base64 images for OCR. This is necessary because local backends typically only accept image inputs.

**File Path Normalization**
Both model implementations normalize file paths to handle:
- Wrapped quotes from copy/paste operations
- `file://` URL schemes (including Windows paths)
- Path separators and relative paths

**Error Handling**
OCR operations use retry logic with exponential backoff. Status checks return structured `{ status, msg }` objects that map to user-facing notices.

**Settings Encryption**
API keys are encrypted using Electron's `safeStorage` when available. The plugin falls back to plain text storage if encryption is unavailable.

### File Structure

```
src/
├── main.ts              # Plugin entry point and orchestration
├── settings.ts          # Settings UI and configuration management
├── modal.ts             # File selection modal
├── status_bar.ts        # Status bar display and polling
├── safeStorage.ts       # Electron safeStorage wrapper
├── utils.ts             # Utility functions (file picker, math normalization)
└── models/
    ├── model.ts         # Model interface and Status enum
    ├── online_model.ts  # Hugging Face API implementation
    └── local_model.ts   # Ollama/llama.cpp implementation
```

### Important Constants

**Supported File Extensions** (defined in `main.ts` and `local_model.ts`)
- Images: png, jpg, jpeg, bmp, dib, eps, gif, ppm, pbm, pgm, pnm, webp
- Documents: pdf

**Timeouts and Retries** (in `local_model.ts`)
- Backend startup timeout: 45s
- OCR request timeout: 180s
- OCR retries: 3 attempts with 5s delay
- Status check intervals: 1s (loading), 5s (ready)

**API Endpoints**
- Hugging Face layout parsing: `https://router.huggingface.co/zai-org/api/paas/v4/layout_parsing`
- Hugging Face auth check: `https://huggingface.co/api/whoami-v2`
- Ollama chat: `{host}:{port}/api/chat`
- llama.cpp chat: `{host}:{port}/v1/chat/completions`

### Development Notes

- The plugin uses Obsidian's `requestUrl` for HTTP requests (not native fetch)
- PDF.js is configured with the legacy build and custom worker
- TypeScript compilation skips lib checks (`-skipLibCheck`) due to Obsidian API types
- The build system uses esbuild with CommonJS output format
- Source maps are inline in dev mode, disabled in production
- All external dependencies (obsidian, electron, codemirror, etc.) are marked as external in esbuild config