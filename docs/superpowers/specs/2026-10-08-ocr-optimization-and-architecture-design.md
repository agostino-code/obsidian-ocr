# Design Spec: Obsidian OCR Optimization and Architectural Improvements

- **Date:** 2026-10-08
- **Status:** Proposed / Review
- **Target Hardware:** NVIDIA GeForce MX450 (2048 MiB / 2 GB VRAM, Turing TU117, CUDA 13.4)

---

## 1. Executive Summary

This specification outlines the technical design for optimizing the **Obsidian OCR** plugin for edge hardware with constrained VRAM (specifically 2 GB VRAM, such as the NVIDIA GeForce MX450). It addresses three core pillars:
1. **VRAM Optimization & Local Inference Performance:** Native support for quantized GGUF weights (`GLM-OCR.Q4_K_M` + `mmproj`), updated `llama.cpp` binary engine, smart image downscaling to prevent visual token explosion, and an in-memory clipboard pipeline.
2. **Configurable OCR Modes & Prompt Engineering:** Task-tailored recognition modes (Full Document / Markdown with formulas & tables, Math / LaTeX Only, Plain Text, Tables Only, or Custom prompt).
3. **UI / UX Modernization & Code Cleanup:** Clean non-destructive placeholder in Obsidian notes during generation, terminology normalization (`latex` -> `ocrText`), and 2GB Low-VRAM preset configurations.

---

## 2. Hardware Profile & Constraints

* **Device:** NVIDIA GeForce MX450
* **Dedicated VRAM:** 2048 MiB (~1.7 GB free during typical desktop use with Obsidian & OS running).
* **Compute Architecture:** Turing (TU117, Compute Capability 7.5).
* **CUDA Environment:** CUDA 13.4 installed on host.
* **Constraints:**
  * Model weights must remain strictly under ~1.1 GB in VRAM to leave 600–900 MB for the context KV cache, visual encoder activations, and OS display buffers.
  * Excessive input image resolutions (e.g. 4K screenshots or scans >2000px) explode visual token requirements, causing latency spikes and Out-Of-Memory (OOM) errors.

---

## 3. Architecture & Components

### 3.1 Local Engine: Updated `llama.cpp` Runtime
* **Location:** Dedicated self-contained folder at `tools/llamacpp/` containing build `b11494` with native CUDA 13.4 support.
* **Fallback & Compatibility:** If a custom path is specified in settings, it is used; otherwise, the plugin looks in `tools/llamacpp/llama-server.exe` before falling back to system `PATH`.
* **Execution Parameters for 2GB Low-VRAM:**
  ```bash
  llama-server.exe \
    -m "<modelsDir>/GLM-OCR.Q4_K_M.gguf" \
    --mmproj "<modelsDir>/GLM-OCR.mmproj-Q8_0.gguf" \
    -c 4096 \
    -ngl 99 \
    --port 8080
  ```
  * `-ngl 99`: Offloads all available layers to GPU.
  * `-c 4096`: Limits KV context memory to ~150-250 MB while providing ample window for multi-paragraph notes and complex tables.

### 3.2 Preprocessing Engine (Smart Downscaling & Encoding)
* **Problem:** Large raw images (>3000px) generate thousands of vision tokens, increasing VRAM allocation by >800 MB and slowing inference by 5-10x.
* **Solution:** A client-side preprocessing pipeline implemented via HTML5 Canvas in `src/utils.ts` / `src/image_processor.ts`:
  * Maximum bounding box: **1536 px** on the longest dimension (configurable in settings: `1280px`, `1536px`, `2048px`, or `original`).
  * If dimensions exceed the maximum, calculate proportional scaling factor preserving aspect ratio.
  * Render with high-quality bicubic interpolation (`imageSmoothingQuality = "high"`).
  * Output format: high-efficiency WebP or JPEG (`quality = 0.92`) for lossy inputs, PNG for diagrams/line art, significantly reducing payload size and base64 transmission overhead.

### 3.3 In-Memory Clipboard Pipeline
* **Problem:** `clipboardToText` currently writes the clipboard blob to disk synchronously via `fs.writeFileSync` in `.clipboard_images/pasted_image.<ext>` and re-reads it via `fs.readFileSync`.
* **Solution:**
  * Read the clipboard blob asynchronously: `await file[0].getType(mimeType)`.
  * Convert directly to `ArrayBuffer` / `Buffer` in memory.
  * Pass the in-memory buffer to the preprocessing pipeline and directly into the model request as Base64.
  * Avoid any temporary file writes, disk locks, or leftover files in the vault.

---

## 4. OCR Modes & Prompt Strategy

### 4.1 Mode Definitions
| Mode | Target Output | Default Prompt | Post-Processing |
| :--- | :--- | :--- | :--- |
| **Document (Default)** | Mixed text, Markdown headers, tables, inline/block formulas | `Text Recognition:` | Normalizes math blocks (`$`, `$$`) and markdown formatting. |
| **Formulas / LaTeX** | Pure LaTeX equations | `Formula Recognition:` | Wraps in `$$...$$` if not already wrapped; cleans delimiter spaces. |
| **Tables Only** | Markdown or HTML tables | `Table Recognition:` | Cleans table formatting and alignment markers. |
| **Plain Text** | Raw text without Markdown/LaTeX styling | `Extract plain text without markdown formatting:` | Strips extraneous syntax. |
| **Custom** | User-defined prompt | User-specified string in settings | Standard trim and whitespace cleanup. |

### 4.2 Integration
* Settings tab provides a dropdown: **Default OCR Mode**.
* Command Palette provides targeted commands:
  * `Paste OCR from clipboard image (default mode)`
  * `Paste OCR from clipboard image (choose mode modal)`
  * `Generate OCR text from selected file`

---

## 5. UI/UX Modernization & Refactoring

### 5.1 Non-Disruptive Note Placeholder
* Replace the rigid `$$\LaTeX \text{ is being generated... }$$` math block with a clean, agnostic Markdown placeholder:
  ```markdown
  %% [Obsidian OCR: Elaborazione immagine in corso...] %%
  ```
  Or a minimal inline indicator that seamlessly swaps with the resulting text without leaving orphaned LaTeX delimiters if the output is standard prose or a table.

### 5.2 Legacy Terminology Cleanup
* Refactor methods, variables, and notices:
  * `imgfileToLatex` -> `processImageToText`
  * `notice.setMessage("Generating Latex...")` -> `notice.setMessage("Processing OCR...")`
  * Menu item: "Generate Formula" -> "Generate OCR Text"

### 5.3 Low-VRAM Configuration Preset Button
* In Settings Tab: a one-click button **"Apply Low-VRAM (2GB MX450) Preset"** that automatically fills:
  * Backend: `llama.cpp`
  * Path: `tools/llamacpp/llama-server.exe` (or detected path)
  * Args: `-m models/GLM-OCR.Q4_K_M.gguf --mmproj models/GLM-OCR.mmproj-Q8_0.gguf -c 4096 -ngl 99 --port 8080`
  * Max Image Dimension: `1536px`

---

## 6. Testing & Validation Plan

1. **Local Model Loading Test:**
   * Launch `llama-server.exe` with the downloaded `GLM-OCR.Q4_K_M.gguf` and `mmproj-GLM-OCR-Q8_0.gguf`.
   * Verify via `nvidia-smi` that VRAM consumption stays below ~1.4 GB and CUDA compute engine is active.
   * Send a test `/v1/chat/completions` request with an image and measure response latency.
2. **Preprocessing Validation:**
   * Test with a sample 4K image: verify it is downscaled to 1536px and base64 size is reduced by >80%.
3. **Clipboard In-Memory Flow:**
   * Verify pasting an image from clipboard directly populates note text without creating files on disk.
4. **Obsidian Plugin Build:**
   * Run `npm run build` (`tsc -noEmit` + `esbuild`) and verify zero type or build errors.

---

## 7. Migration & Compatibility

* Existing settings are preserved; new settings are populated with sensible defaults.
* The HuggingFace API fallback remains fully functional for users who choose not to run local inference.
