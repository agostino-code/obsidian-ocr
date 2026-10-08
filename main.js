var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ObsidianOCR
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");
var path4 = __toESM(require("path"));
var fs4 = __toESM(require("fs"));

// src/models/local_model.ts
var import_child_process = require("child_process");
var fs = __toESM(require("fs"));
var import_obsidian = require("obsidian");
var path = __toESM(require("path"));
var IMG_EXTS = ["png", "jpg", "jpeg", "bmp", "dib", "eps", "gif", "ppm", "pbm", "pgm", "pnm", "webp"];
var PDF_EXT = "pdf";
var SUPPORTED_EXTS = [...IMG_EXTS, PDF_EXT];
var OLLAMA_OCR_TIMEOUT_MS = 18e4;
var OLLAMA_OCR_RETRIES = 6;
var OLLAMA_OCR_RETRY_DELAY_MS = 5e3;
var OLLAMA_OCR_PROMPT = "Text Recognition:";
var OLLAMA_OCR_MAX_TOKENS = 4096;
var BACKEND_STARTUP_TIMEOUT_MS = 18e4;
var BACKEND_STARTUP_POLL_MS = 1e3;
var ARG_TOKEN_REGEX = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;
var LocalModel = class {
  constructor(settings) {
    this.statusCheckIntervalLoading = 1e3;
    this.statusCheckIntervalReady = 5e3;
    // Circuit breaker for backend reachability
    this.lastUnreachableTime = 0;
    this.unreachableCount = 0;
    this.CIRCUIT_BREAKER_THRESHOLD = 3;
    this.CIRCUIT_BREAKER_TIMEOUT_MS = 6e4;
    // Cache last status result to avoid redundant checks
    this.cachedStatus = null;
    this.STATUS_CACHE_TTL_MS = 2e3;
    this.plugin_settings = settings;
  }
  reloadSettings(settings) {
    this.plugin_settings = settings;
  }
  load() {
    const modelLabel = this.getBackendType() === "llama.cpp" ? this.plugin_settings.llamaCppArgs : this.plugin_settings.ollamaModel;
    console.log(`obsidian_ocr: local ${this.getBackendDisplayName()} model loaded (${modelLabel})`);
  }
  unload() {
    this.killServer();
  }
  getBaseUrl() {
    const backend = this.getBackendType();
    const host = backend === "llama.cpp" ? this.plugin_settings.llamaCppHost : this.plugin_settings.ollamaHost;
    const port = backend === "llama.cpp" ? this.plugin_settings.llamaCppPort : this.plugin_settings.ollamaPort;
    return `${host.replace(/\/$/, "")}:${port}`;
  }
  getBackendType() {
    return this.plugin_settings.localBackend === "llama.cpp" ? "llama.cpp" : "ollama";
  }
  getBackendDisplayName() {
    return this.getBackendType() === "llama.cpp" ? "llama.cpp" : "Ollama";
  }
  killServer() {
    if (!this.serverProcess) {
      return;
    }
    try {
      this.serverProcess.kill();
      console.log(`obsidian_ocr: stopped spawned ${this.getBackendDisplayName()} process (PID: ${this.serverProcess.pid})`);
    } catch (err) {
      console.debug(`obsidian_ocr: failed to stop ${this.getBackendDisplayName()} process`, err);
    }
    this.serverProcess = void 0;
  }
  async isBackendReachable(forceCheck = false) {
    const now = Date.now();
    if (!forceCheck && this.unreachableCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      if (now - this.lastUnreachableTime < this.CIRCUIT_BREAKER_TIMEOUT_MS) {
        console.debug(`obsidian_ocr: circuit breaker open, skipping reachability check (count: ${this.unreachableCount})`);
        return false;
      }
      this.unreachableCount = 0;
    }
    if (!forceCheck && this.cachedStatus && now - this.cachedStatus.timestamp < this.STATUS_CACHE_TTL_MS) {
      return this.cachedStatus.status === 0 /* Ready */;
    }
    const baseUrl = this.getBaseUrl();
    const backend = this.getBackendType();
    const urls = backend === "llama.cpp" ? [`${baseUrl}/health`, `${baseUrl}/v1/models`] : [`${baseUrl}/api/version`];
    for (const url of urls) {
      try {
        const response = await (0, import_obsidian.requestUrl)({
          url,
          method: "GET"
        });
        if (response.status >= 200 && response.status < 300) {
          this.cachedStatus = { status: 0 /* Ready */, msg: "Backend reachable", timestamp: now };
          this.unreachableCount = 0;
          return true;
        }
      } catch (err) {
        console.debug(`obsidian_ocr: backend check failed for ${url}: ${err}`);
      }
    }
    this.lastUnreachableTime = now;
    this.unreachableCount++;
    this.cachedStatus = { status: 3 /* Unreachable */, msg: "Backend not reachable", timestamp: now };
    console.debug(`obsidian_ocr: backend unreachable (count: ${this.unreachableCount}/${this.CIRCUIT_BREAKER_THRESHOLD})`);
    return false;
  }
  async getInstalledModels() {
    var _a2;
    try {
      const response = await (0, import_obsidian.requestUrl)({
        url: `${this.getBaseUrl()}/api/tags`,
        method: "GET"
      });
      const tags = response.json;
      return ((_a2 = tags.models) != null ? _a2 : []).map((model) => {
        var _a3;
        return (_a3 = model.name) == null ? void 0 : _a3.toLowerCase();
      }).filter((name) => !!name);
    } catch (e) {
      return [];
    }
  }
  async getLoadedModels() {
    var _a2;
    const response = await (0, import_obsidian.requestUrl)({
      url: `${this.getBaseUrl()}/api/ps`,
      method: "GET"
    });
    const running = response.json;
    return ((_a2 = running.models) != null ? _a2 : []).map((model) => {
      var _a3;
      return (_a3 = model.name) == null ? void 0 : _a3.toLowerCase();
    }).filter((name) => !!name);
  }
  isConfiguredModelInList(models) {
    const configuredModel = this.plugin_settings.ollamaModel.toLowerCase();
    return models.some((name) => {
      const base = name.split(":")[0];
      const configuredBase = configuredModel.split(":")[0];
      return name === configuredModel || name === `${configuredModel}:latest` || base === configuredBase;
    });
  }
  checkBackendInstallation() {
    const backend = this.getBackendType();
    const command = backend === "llama.cpp" ? this.plugin_settings.llamaCppPath : this.plugin_settings.ollamaPath;
    return new Promise((resolve2, reject) => {
      const process = (0, import_child_process.spawn)(command, ["--version"]);
      process.on("close", (code) => {
        if (code === 0) {
          resolve2();
        } else {
          reject(new Error(`${this.getBackendDisplayName()} was found at '${command}' but failed to run.`));
        }
      });
      process.on("error", (err) => {
        if (`${err}`.includes("ENOENT")) {
          reject(new Error(`Could not find ${this.getBackendDisplayName()} command '${command}'.`));
        } else {
          reject(new Error(`${err}`));
        }
      });
    });
  }
  spawnOllamaServer() {
    return new Promise((resolve2, reject) => {
      var _a2, _b2;
      const process = (0, import_child_process.spawn)(this.plugin_settings.ollamaPath, ["serve"]);
      process.on("spawn", () => {
        console.log(`obsidian_ocr: spawned ollama serve (PID: ${process.pid})`);
        resolve2(process);
      });
      process.on("error", (err) => {
        reject(err);
      });
      (_a2 = process.stdout) == null ? void 0 : _a2.on("data", (data) => {
        console.debug(`ollama: ${data.toString()}`);
      });
      (_b2 = process.stderr) == null ? void 0 : _b2.on("data", (data) => {
        console.debug(`ollama: ${data.toString()}`);
      });
      process.on("close", (code) => {
        var _a3;
        console.log(`obsidian_ocr: ollama serve exited (${code})`);
        if (((_a3 = this.serverProcess) == null ? void 0 : _a3.pid) === process.pid) {
          this.serverProcess = void 0;
        }
      });
    });
  }
  parseArgs(rawArgs) {
    var _a2, _b2;
    const args = [];
    const trimmed = rawArgs.trim();
    if (!trimmed) {
      return args;
    }
    for (const match of trimmed.matchAll(ARG_TOKEN_REGEX)) {
      const token = (_b2 = (_a2 = match[1]) != null ? _a2 : match[2]) != null ? _b2 : match[0];
      args.push(token);
    }
    return args;
  }
  spawnLlamaCppServer() {
    return new Promise((resolve2, reject) => {
      var _a2, _b2;
      const args = this.parseArgs(this.plugin_settings.llamaCppArgs);
      const process = (0, import_child_process.spawn)(this.plugin_settings.llamaCppPath, args);
      process.on("spawn", () => {
        console.log(`obsidian_ocr: spawned llama.cpp server (PID: ${process.pid})`);
        resolve2(process);
      });
      process.on("error", (err) => {
        reject(err);
      });
      (_a2 = process.stdout) == null ? void 0 : _a2.on("data", (data) => {
        console.debug(`llama.cpp: ${data.toString()}`);
      });
      (_b2 = process.stderr) == null ? void 0 : _b2.on("data", (data) => {
        console.debug(`llama.cpp: ${data.toString()}`);
      });
      process.on("close", (code) => {
        var _a3;
        console.log(`obsidian_ocr: llama.cpp server exited (${code})`);
        if (((_a3 = this.serverProcess) == null ? void 0 : _a3.pid) === process.pid) {
          this.serverProcess = void 0;
        }
      });
    });
  }
  spawnBackendServer() {
    if (this.getBackendType() === "llama.cpp") {
      return this.spawnLlamaCppServer();
    }
    return this.spawnOllamaServer();
  }
  sleep(ms) {
    return new Promise((resolve2) => setTimeout(resolve2, ms));
  }
  withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve2, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1e3)}s`));
      }, timeoutMs);
      promise.then((value) => {
        clearTimeout(timeoutId);
        resolve2(value);
      }).catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }
  extractRequestErrorMessage(error, fallbackLabel) {
    var _a2, _b2;
    if (error && typeof error === "object") {
      const response = error;
      if (typeof ((_a2 = response.response) == null ? void 0 : _a2.text) === "string" && response.response.text.trim()) {
        return `${fallbackLabel}: ${response.response.text.trim()}`;
      }
      if (((_b2 = response.response) == null ? void 0 : _b2.json) && typeof response.response.json === "object") {
        return `${fallbackLabel}: ${JSON.stringify(response.response.json)}`;
      }
      if (typeof response.message === "string" && response.message.trim()) {
        const status = typeof response.status === "number" ? ` (status ${response.status}${response.statusText ? ` ${response.statusText}` : ""})` : "";
        return `${fallbackLabel}: ${response.message.trim()}${status}`;
      }
    }
    return `${fallbackLabel}: ${String(error)}`;
  }
  async waitForBackendReachable(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isBackendReachable()) {
        return true;
      }
      await this.sleep(BACKEND_STARTUP_POLL_MS);
    }
    return false;
  }
  async ensureBackendReadyForOCR(notice) {
    if (await this.isBackendReachable(true)) {
      console.log(`obsidian_ocr: backend already reachable at ${this.getBaseUrl()}`);
      return;
    }
    if (notice) {
      notice.setMessage(`\u{1F680} Starting ${this.getBackendDisplayName()} backend...`);
    }
    console.log(`obsidian_ocr: checking ${this.getBackendDisplayName()} installation...`);
    await this.checkBackendInstallation();
    if (this.serverProcess) {
      console.log(`obsidian_ocr: waiting for existing backend to become reachable...`);
      const becameReady = await this.waitForBackendReachable(15e3);
      if (becameReady) {
        console.log(`obsidian_ocr: backend became reachable`);
        return;
      }
      console.log(`obsidian_ocr: killing unresponsive backend process`);
      this.killServer();
    }
    console.log(`obsidian_ocr: spawning ${this.getBackendDisplayName()} server...`);
    this.serverProcess = await this.spawnBackendServer();
    const reachable = await this.waitForBackendReachable(BACKEND_STARTUP_TIMEOUT_MS);
    if (!reachable) {
      throw new Error(`${this.getBackendDisplayName()} did not become reachable at ${this.getBaseUrl()} within ${Math.round(BACKEND_STARTUP_TIMEOUT_MS / 1e3)}s`);
    }
    console.log(`obsidian_ocr: backend is now reachable at ${this.getBaseUrl()}`);
    await this.sleep(2e3);
  }
  async requestOllamaOCR(imageB64) {
    var _a2, _b2, _c2;
    const response = await this.withTimeout(
      (0, import_obsidian.requestUrl)({
        url: `${this.getBaseUrl().replace(/\/$/, "")}/api/chat`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.plugin_settings.ollamaModel,
          stream: false,
          messages: [
            {
              role: "user",
              content: OLLAMA_OCR_PROMPT,
              images: [imageB64]
            }
          ]
        }),
        throw: false
      }),
      OLLAMA_OCR_TIMEOUT_MS,
      "Ollama OCR request"
    );
    if (response.status >= 400) {
      throw new Error(`Ollama OCR request failed with status ${response.status}: ${JSON.stringify(response.json || response.text || "")}`);
    }
    const result = response.json;
    const latex = ((_c2 = (_b2 = (_a2 = result.message) == null ? void 0 : _a2.content) != null ? _b2 : result.response) != null ? _c2 : "").trim();
    if (!latex) {
      throw new Error(`Malformed response from Ollama: ${JSON.stringify(result)}`);
    }
    return latex;
  }
  async requestLlamaCppOCR(imageB64, ext) {
    var _a2, _b2, _c2;
    const response = await this.withTimeout(
      (0, import_obsidian.requestUrl)({
        url: `${this.getBaseUrl().replace(/\/$/, "")}/v1/chat/completions`,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: OLLAMA_OCR_PROMPT },
                { type: "image_url", image_url: { url: `data:image/${ext};base64,${imageB64}` } }
              ]
            }
          ],
          temperature: 0,
          top_k: 1,
          stream: false,
          max_tokens: OLLAMA_OCR_MAX_TOKENS
        }),
        throw: false
      }),
      OLLAMA_OCR_TIMEOUT_MS,
      "llama.cpp OCR request"
    ).catch((error) => {
      throw new Error(this.extractRequestErrorMessage(error, "llama.cpp OCR request failed"));
    });
    if (response.status >= 400) {
      throw new Error(`llama.cpp OCR request failed with status ${response.status}: ${JSON.stringify(response.json || response.text || "")}`);
    }
    const result = response.json;
    const content = (_c2 = (_b2 = (_a2 = result.choices) == null ? void 0 : _a2[0]) == null ? void 0 : _b2.message) == null ? void 0 : _c2.content;
    const latex = typeof content === "string" ? content.trim() : Array.isArray(content) ? content.map((item) => {
      var _a3;
      return (_a3 = item == null ? void 0 : item.text) == null ? void 0 : _a3.trim();
    }).filter((part) => !!part).join("\n").trim() : "";
    if (!latex) {
      throw new Error(`Malformed response from llama.cpp: ${JSON.stringify(result)}`);
    }
    return latex;
  }
  async prepareBackendForOCR(notice) {
    await this.ensureBackendReadyForOCR(notice);
    if (this.getBackendType() !== "ollama") {
      return;
    }
    try {
      const loadedModels = await this.getLoadedModels();
      if (!this.isConfiguredModelInList(loadedModels)) {
        new import_obsidian.Notice(`\u2699\uFE0F Model '${this.plugin_settings.ollamaModel}' is not loaded yet. Warming up...`, 4e3);
      }
    } catch (psError) {
      console.warn("obsidian_ocr: preliminary /api/ps check failed", psError);
    }
  }
  async renderPdfPageToBase64(pdfDocument, pageNumber) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(`Could not create canvas context while rendering PDF page ${pageNumber}`);
    }
    try {
      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/png");
      const [, base64] = dataUrl.split(",", 2);
      if (!base64) {
        throw new Error(`Failed to render PDF page ${pageNumber}`);
      }
      return base64;
    } finally {
      page.cleanup();
    }
  }
  getImageMimeType(ext) {
    switch (ext.toLowerCase()) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "gif":
        return "image/gif";
      case "bmp":
      case "dib":
        return "image/bmp";
      default:
        return `image/${ext.toLowerCase()}`;
    }
  }
  loadImage(dataUrl) {
    return new Promise((resolve2, reject) => {
      const image = new Image();
      image.onload = () => resolve2(image);
      image.onerror = () => reject(new Error("Could not decode image for OCR"));
      image.src = dataUrl;
    });
  }
  async normalizeImageFileToPngBase64(filepath, ext) {
    const data = fs.readFileSync(filepath);
    const image = await this.loadImage(`data:${this.getImageMimeType(ext)};base64,${data.toString("base64")}`);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not create canvas context while normalizing image");
    }
    context.drawImage(image, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    const [, base64] = dataUrl.split(",", 2);
    if (!base64) {
      throw new Error("Failed to normalize image for OCR");
    }
    return base64;
  }
  async ocrRenderedImage(imageB64, ext, notice, label) {
    const backend = this.getBackendType();
    const backendLabel = this.getBackendDisplayName();
    let lastError;
    for (let attempt = 1; attempt <= OLLAMA_OCR_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          notice.setMessage(`\u2699\uFE0F Generating Latex for ${label}... retry ${attempt}/${OLLAMA_OCR_RETRIES}`);
          console.log(`obsidian_ocr: retrying OCR for ${label}, attempt ${attempt}/${OLLAMA_OCR_RETRIES}`);
        }
        if (backend === "llama.cpp") {
          return await this.requestLlamaCppOCR(imageB64, ext);
        }
        return await this.requestOllamaOCR(imageB64);
      } catch (error) {
        lastError = error;
        const isLast = attempt === OLLAMA_OCR_RETRIES;
        const errorMsg2 = String(error);
        if (errorMsg2.includes("status 400") || errorMsg2.includes("status 404") || errorMsg2.includes("status 401")) {
          console.warn(`obsidian_ocr: ${backendLabel} OCR failed with unrecoverable error for ${label}: ${error}`);
          break;
        }
        console.warn(`obsidian_ocr: ${backendLabel} OCR attempt ${attempt}/${OLLAMA_OCR_RETRIES} failed for ${label}: ${error}`);
        if (!isLast) {
          await this.ensureBackendReadyForOCR(notice);
          await this.sleep(OLLAMA_OCR_RETRY_DELAY_MS);
        }
      }
    }
    const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`${backendLabel} OCR failed after ${OLLAMA_OCR_RETRIES} attempts: ${errorMsg}`);
  }
  async imageFileToLatex(filepath, notice, label, ext) {
    const backend = this.getBackendType();
    if (backend === "llama.cpp") {
      try {
        const imageB642 = await this.normalizeImageFileToPngBase64(filepath, ext);
        return await this.ocrRenderedImage(imageB642, "png", notice, label);
      } catch (error) {
        console.warn(`obsidian_ocr: image normalization failed for ${label}, falling back to raw bytes`, error);
      }
    }
    const data = fs.readFileSync(filepath);
    const imageB64 = data.toString("base64");
    return await this.ocrRenderedImage(imageB64, ext, notice, label);
  }
  async pdfFileToLatex(filepath, notice, label) {
    const pdfData = fs.readFileSync(filepath);
    const pdfjsLib = await (0, import_obsidian.loadPdfJs)();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfData), disableWorker: true });
    const pdfDocument = await loadingTask.promise;
    try {
      const pageLatex = [];
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
        notice.setMessage(`\u2699\uFE0F Generating Latex for ${label}... page ${pageNumber}/${pdfDocument.numPages}`);
        const imageB64 = await this.renderPdfPageToBase64(pdfDocument, pageNumber);
        const latex = await this.ocrRenderedImage(imageB64, "png", notice, `${label} page ${pageNumber}/${pdfDocument.numPages}`);
        pageLatex.push(latex);
      }
      return pageLatex.join("\n\n");
    } finally {
      await pdfDocument.destroy();
    }
  }
  async canOpenAsPdf(filepath) {
    try {
      const pdfData = fs.readFileSync(filepath);
      const pdfjsLib = await (0, import_obsidian.loadPdfJs)();
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfData), disableWorker: true });
      const pdfDocument = await loadingTask.promise;
      await pdfDocument.destroy();
      return true;
    } catch (e) {
      return false;
    }
  }
  detectFileTypeFromMagicHeader(filepath) {
    try {
      const handle = fs.openSync(filepath, "r");
      try {
        const buffer = Buffer.alloc(1024);
        const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
        if (bytesRead < 4) {
          return null;
        }
        if (bytesRead >= 5 && buffer.toString("ascii", 0, bytesRead).includes("%PDF-")) {
          return PDF_EXT;
        }
        if (bytesRead >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
          return "png";
        }
        if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
          return "jpg";
        }
        if (bytesRead >= 6) {
          const gifHeader = buffer.toString("ascii", 0, 6);
          if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
            return "gif";
          }
        }
        if (buffer[0] === 66 && buffer[1] === 77) {
          return "bmp";
        }
        if (bytesRead >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
          return "webp";
        }
        return null;
      } finally {
        fs.closeSync(handle);
      }
    } catch (e) {
      return null;
    }
  }
  resolveInputExt(filepath, ext) {
    const normalizedExt = ext.trim().replace(/^\./, "").toLowerCase();
    if (SUPPORTED_EXTS.includes(normalizedExt)) {
      return normalizedExt;
    }
    const detectedExt = this.detectFileTypeFromMagicHeader(filepath);
    if (detectedExt && SUPPORTED_EXTS.includes(detectedExt)) {
      return detectedExt;
    }
    return normalizedExt;
  }
  normalizeInputPath(filepath) {
    let normalized = (filepath != null ? filepath : "").trim();
    if (!normalized) {
      return "";
    }
    normalized = normalized.replace(/^['"]+|['"]+$/g, "");
    if (!normalized) {
      return "";
    }
    if (normalized.toLowerCase().startsWith("file://")) {
      try {
        const url = new URL(normalized);
        normalized = decodeURIComponent(url.pathname);
        if (/^\/[A-Za-z]:\//.test(normalized)) {
          normalized = normalized.substring(1);
        }
      } catch (e) {
      }
    }
    normalized = normalized.trim();
    if (!normalized) {
      return "";
    }
    return path.normalize(normalized);
  }
  ensureReadableFile(filepath) {
    if (!filepath.trim()) {
      throw new Error("No file path provided");
    }
    if (!fs.existsSync(filepath)) {
      throw new Error(`File does not exist: ${filepath}`);
    }
    const stat = fs.statSync(filepath);
    if (!stat.isFile()) {
      throw new Error(`Selected path is not a file: ${filepath}`);
    }
  }
  async imgfileToLatex(filepath) {
    const resolvedPath = this.normalizeInputPath(filepath);
    const file = path.parse(resolvedPath);
    const ext = file.ext.substring(1);
    this.ensureReadableFile(resolvedPath);
    let resolvedExt = this.resolveInputExt(resolvedPath, ext);
    const notice = new import_obsidian.Notice(`\u2699\uFE0F Analyzing ${file.base}...`, 0);
    try {
      await this.prepareBackendForOCR(notice);
      notice.setMessage(`\u2699\uFE0F Generating Latex for ${file.base}...`);
      if (resolvedExt === PDF_EXT) {
        return await this.pdfFileToLatex(resolvedPath, notice, file.base);
      }
      if (!IMG_EXTS.includes(resolvedExt)) {
        const canOpenAsPdf = await this.canOpenAsPdf(resolvedPath);
        if (canOpenAsPdf) {
          return await this.pdfFileToLatex(resolvedPath, notice, file.base);
        }
        resolvedExt = "png";
      }
      return await this.imageFileToLatex(resolvedPath, notice, file.base, resolvedExt);
    } finally {
      setTimeout(() => notice.hide(), 1e3);
    }
  }
  async status() {
    const backend = this.getBackendType();
    const backendLabel = this.getBackendDisplayName();
    const now = Date.now();
    try {
      const reachable = await this.isBackendReachable();
      if (!reachable) {
        try {
          await this.checkBackendInstallation();
        } catch (e) {
          console.debug(`obsidian_ocr: status check - installation check failed: ${e}`);
        }
        const msg = `${backendLabel} is not reachable at ${this.getBaseUrl()}.`;
        console.debug(`obsidian_ocr: status check - ${msg}`);
        return {
          status: 3 /* Unreachable */,
          msg
        };
      }
      if (backend === "llama.cpp") {
        console.debug(`obsidian_ocr: status check - llama.cpp server ready at ${this.getBaseUrl()}`);
        return { status: 0 /* Ready */, msg: "llama.cpp server is ready", lastChecked: now };
      }
      const models = await this.getInstalledModels();
      const configuredModel = this.plugin_settings.ollamaModel.toLowerCase();
      const modelFound = models.some((name) => {
        return name === configuredModel || name === `${configuredModel}:latest`;
      });
      if (!modelFound) {
        const msg = `Model '${this.plugin_settings.ollamaModel}' not found. Run: ollama pull ${this.plugin_settings.ollamaModel}`;
        console.warn(`obsidian_ocr: status check - ${msg}`);
        return {
          status: 4 /* Misconfigured */,
          msg
        };
      }
      console.debug(`obsidian_ocr: status check - Ollama ready at ${this.getBaseUrl()}, model: ${this.plugin_settings.ollamaModel}`);
      return { status: 0 /* Ready */, msg: "Ollama is ready", lastChecked: now };
    } catch (err) {
      const msg = `${err}`;
      console.debug(`obsidian_ocr: status check failed:`, err);
      return { status: 4 /* Misconfigured */, msg };
    }
  }
  async start() {
    const backendLabel = this.getBackendDisplayName();
    this.unreachableCount = 0;
    this.cachedStatus = null;
    const reachable = await this.isBackendReachable(true);
    if (reachable) {
      console.log(`obsidian_ocr: ${backendLabel} already running`);
      return;
    }
    try {
      this.serverProcess = await this.spawnBackendServer();
      new import_obsidian.Notice(`${backendLabel} started successfully.`, 3e3);
    } catch (err) {
      console.error(err);
      new import_obsidian.Notice(`\u274C Could not start ${backendLabel}: ${err}`, 1e4);
    }
  }
};

// src/status_bar.ts
var StatusBar = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.span = plugin.addStatusBarItem();
    this.span.createEl("span", { text: "Obsidian OCR \u274C" });
    this.updateStatusBar();
    if (!plugin.settings.showStatusBar) {
      this.hide();
    }
    this.should_stop = false;
    this.startStatusBar();
  }
  // Update the status bar based on current OCR backend availability.
  async updateStatusBar() {
    const status = await this.plugin.model.status();
    switch (status.status) {
      case 0 /* Ready */:
        this.span.setText("Obsidian OCR \u2705");
        break;
      case 2 /* Downloading */:
        this.span.setText("Obsidian OCR \u{1F310}");
        break;
      case 1 /* Loading */:
        this.span.setText("Obsidian OCR \u2699\uFE0F");
        break;
      case 4 /* Misconfigured */:
        this.span.setText("Obsidian OCR \u{1F527}");
        break;
      case 3 /* Unreachable */:
        this.span.setText("Obsidian OCR \u274C");
        break;
    }
    return status;
  }
  // Call `updateStatusBar` periodically based on the returned status.
  // This function halts when `this.stopped` is True.
  //
  // This function should only be called once.
  async startStatusBar() {
    if (this.started) {
      console.error("Attempted to start status bar when already started");
      return;
    }
    let prevStatus = { status: 1 /* Loading */, msg: "" };
    let loadingSleepTime = this.plugin.model.statusCheckIntervalReady;
    this.started = true;
    while (!this.should_stop) {
      const status = await this.updateStatusBar();
      if (status.status === 0 /* Ready */) {
        await sleep(this.plugin.model.statusCheckIntervalReady);
      } else {
        if (status.status === prevStatus.status && status.msg === prevStatus.msg) {
          loadingSleepTime = Math.min(
            loadingSleepTime * 2,
            this.plugin.model.statusCheckIntervalReady * 2
          );
        } else {
          loadingSleepTime = this.plugin.model.statusCheckIntervalLoading;
        }
        await sleep(loadingSleepTime);
      }
      prevStatus = status;
    }
    this.started = false;
  }
  hide() {
    this.span.hide();
  }
  show() {
    this.span.show();
  }
  stop() {
    this.should_stop = true;
  }
};

// src/modal.ts
var import_obsidian2 = require("obsidian");
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// src/utils.ts
async function picker(message, properties) {
  const dirPath = window.electron.remote.dialog.showOpenDialogSync({
    title: message,
    properties
  });
  if (!dirPath || dirPath.length === 0) {
    return void 0;
  }
  if (properties.includes("multiSelections")) return dirPath;
  else return dirPath[0];
}
async function copyToClipboard(text) {
  var _a2, _b2;
  if ((_a2 = navigator == null ? void 0 : navigator.clipboard) == null ? void 0 : _a2.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (e) {
    }
  }
  try {
    const electron = window.electron;
    if ((_b2 = electron == null ? void 0 : electron.clipboard) == null ? void 0 : _b2.writeText) {
      electron.clipboard.writeText(text);
      return;
    }
  } catch (e) {
  }
}
function normalizeMathForObsidian(text, forceWrap = true) {
  if (!text) {
    return text;
  }
  let trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:latex|tex)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    trimmed = fenceMatch[1].trim();
  }
  const isEnclosedByDisplayDollar = trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length >= 4;
  const isEnclosedByInlineDollar = !isEnclosedByDisplayDollar && trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length >= 2;
  const isEnclosedBySlashBracket = trimmed.startsWith("\\[") && trimmed.endsWith("\\]") && trimmed.length >= 4;
  const isEnclosedBySlashParen = trimmed.startsWith("\\(") && trimmed.endsWith("\\)") && trimmed.length >= 4;
  if (isEnclosedBySlashBracket) {
    const inner = trimmed.slice(2, -2).trim();
    return inner.includes("\n") ? `$$
${inner}
$$` : `$$${inner}$$`;
  }
  if (isEnclosedBySlashParen) {
    const inner = trimmed.slice(2, -2).trim();
    return `$${inner}$`;
  }
  if (isEnclosedByDisplayDollar) {
    const inner = trimmed.slice(2, -2).trim();
    return inner.includes("\n") ? `$$
${inner}
$$` : `$$${inner}$$`;
  }
  if (isEnclosedByInlineDollar) {
    const inner = trimmed.slice(1, -1).trim();
    return `$${inner}$`;
  }
  if (/\$[^$]+\$/.test(trimmed)) {
    return trimmed.replace(/\$(?!\$)([^$\n]*?)\$(?!\$)/g, (match, inner) => {
      const innerTrimmed = inner.trim();
      return innerTrimmed ? `$${innerTrimmed}$` : match;
    }).replace(/\$\$([\s\S]*?)\$\$/g, (_match, inner) => {
      const innerTrimmed = inner.trim();
      return innerTrimmed.includes("\n") ? `$$
${innerTrimmed}
$$` : `$$${innerTrimmed}$$`;
    });
  }
  if (!forceWrap) {
    return trimmed;
  }
  if (trimmed.includes("\n")) {
    return `$$
${trimmed}
$$`;
  } else {
    return `$$${trimmed}$$`;
  }
}

// src/modal.ts
function getPreviewDataUrl(filepath) {
  if (!fs2.existsSync(filepath) || !fs2.statSync(filepath).isFile()) {
    return null;
  }
  const ext = path2.extname(filepath).toLowerCase();
  let contentType = null;
  if (ext === ".jpg" || ext === ".jpeg") {
    contentType = "image/jpeg";
  } else if (ext === ".png") {
    contentType = "image/png";
  } else if (ext === ".webp") {
    contentType = "image/webp";
  } else if (ext === ".gif") {
    contentType = "image/gif";
  } else if (ext === ".bmp" || ext === ".dib") {
    contentType = "image/bmp";
  }
  if (!contentType) {
    return null;
  }
  const fileData = fs2.readFileSync(filepath);
  return `data:${contentType};base64,${fileData.toString("base64")}`;
}
var ObsidianOCRModal = class extends import_obsidian2.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    this.containerEl.addClass("obsidian-ocr-modal");
    const { contentEl, titleEl } = this;
    titleEl.setText("Obsidian OCR");
    const imageContainer = contentEl.createDiv({
      cls: "image-container"
    });
    const img = imageContainer.createEl("img");
    const selectedFileName = contentEl.createEl("p", {
      cls: "selected-file-name",
      text: "No file selected"
    });
    new import_obsidian2.Setting(contentEl).setName("Open file").addExtraButton((cb) => cb.setIcon("folder").setTooltip("Browse").onClick(async () => {
      const file = await picker("Open file", ["openFile"]);
      if (!file) {
        return;
      }
      const normalizedFile = file.trim();
      if (!normalizedFile || !fs2.existsSync(normalizedFile) || !fs2.statSync(normalizedFile).isFile()) {
        new import_obsidian2.Notice("\u26A0\uFE0F Please select a valid file (not a folder)");
        return;
      }
      this.imagePath = normalizedFile;
      selectedFileName.setText(`Selected file: ${path2.basename(normalizedFile)}`);
      const ext = path2.extname(normalizedFile).toLowerCase();
      const tfile = this.app.vault.getAbstractFileByPath(path2.relative(this.plugin.vaultPath, normalizedFile));
      if (tfile instanceof import_obsidian2.TFile && ext !== ".pdf") {
        img.setAttr("src", this.app.vault.getResourcePath(tfile));
      } else {
        const preview = getPreviewDataUrl(normalizedFile);
        if (preview) {
          img.setAttr("src", preview);
        } else {
          img.removeAttribute("src");
        }
      }
    })).addButton((button) => button.setButtonText("Convert to Latex").setCta().onClick(() => {
      const { imagePath, plugin } = this;
      if (imagePath) {
        this.close();
        plugin.model.imgfileToLatex(imagePath).then(async (latex) => {
          const normalizedLatex = normalizeMathForObsidian(latex);
          try {
            await copyToClipboard(normalizedLatex);
          } catch (err) {
            console.error(err);
            new import_obsidian2.Notice(`\u26A0\uFE0F Couldn't copy to clipboard because document isn't focused`);
          }
          new import_obsidian2.Notice(`\u{1FA84} Latex copied to clipboard`);
        }).catch((err) => {
          new import_obsidian2.Notice(`\u26A0\uFE0F ${err}`);
        });
      } else {
        new import_obsidian2.Notice("\u26A0\uFE0F Select a file first (image or PDF)");
      }
    }));
  }
  onClose() {
    const { contentEl } = this;
    this.imagePath = "";
    contentEl.empty();
  }
};

// src/models/online_model.ts
var fs3 = __toESM(require("fs"));

// src/safeStorage.ts
var safeStorage;
var _a, _b, _c;
try {
  const Electron = require("electron");
  safeStorage = ((_a = Electron == null ? void 0 : Electron.remote) == null ? void 0 : _a.safeStorage) || (Electron == null ? void 0 : Electron.safeStorage) || typeof window !== "undefined" && ((_c = (_b = window.electron) == null ? void 0 : _b.remote) == null ? void 0 : _c.safeStorage);
} catch (e) {
  safeStorage = void 0;
}
if (!safeStorage) {
  safeStorage = {
    isEncryptionAvailable: () => false,
    encryptString: (val) => Buffer.from(val, "utf-8"),
    decryptString: (buf) => buf.toString("utf-8")
  };
}
var safeStorage_default = safeStorage;

// src/models/online_model.ts
var import_obsidian3 = require("obsidian");
var path3 = __toESM(require("path"));
var HF_OCR_MODEL = "zai-org/GLM-OCR";
var HF_LAYOUT_PARSING_URL = "https://router.huggingface.co/zai-org/api/paas/v4/layout_parsing";
var HF_ROUTER_MODEL = "glm-ocr";
var SUPPORTED_LAYOUT_PARSING_TYPES = ["image/jpeg", "image/png", "application/pdf"];
function getImageContentType(filepath) {
  const ext = path3.extname(filepath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".pdf") {
    return "application/pdf";
  }
  return "application/octet-stream";
}
function extractRouterError(response) {
  if (!response || typeof response !== "object") {
    return "";
  }
  const errorValue = response.error;
  if (typeof errorValue === "string" && errorValue.trim()) {
    return errorValue.trim();
  }
  if (errorValue && typeof errorValue === "object") {
    const msg = errorValue.message;
    if (typeof msg === "string" && msg.trim()) {
      return msg.trim();
    }
  }
  return "";
}
function extractLayoutText(response) {
  if (!response || typeof response !== "object") {
    return "";
  }
  const layoutDetails = response.layout_details;
  if (Array.isArray(layoutDetails)) {
    const parts = [];
    for (const page of layoutDetails) {
      if (!Array.isArray(page)) {
        continue;
      }
      for (const block of page) {
        const text = block == null ? void 0 : block.content;
        if (typeof text === "string" && text.trim()) {
          parts.push(text.trim());
        }
      }
    }
    if (parts.length > 0) {
      return parts.join("\n\n");
    }
  }
  return "";
}
var ApiModel = class {
  // 1 hour
  constructor(settings) {
    this.statusCheckIntervalLoading = 5e3;
    this.statusCheckIntervalReady = 15e3;
    // Circuit breaker for API reachability
    this.lastUnreachableTime = 0;
    this.unreachableCount = 0;
    this.CIRCUIT_BREAKER_THRESHOLD = 3;
    this.CIRCUIT_BREAKER_TIMEOUT_MS = 6e4;
    // Cache last status result to avoid redundant checks
    this.cachedStatus = null;
    this.STATUS_CACHE_TTL_MS = 1e3 * 60 * 60;
    this.reloadSettings(settings);
  }
  reloadSettings(settings) {
    this.cachedStatus = null;
    this.settings = settings;
    try {
      if (safeStorage_default.isEncryptionAvailable()) {
        this.apiKey = safeStorage_default.decryptString(Buffer.from(settings.hfApiKey));
      } else {
        this.apiKey = settings.hfApiKey;
      }
    } catch (error) {
      new import_obsidian3.Notice(`\u274C There was an error loading your API key`);
      console.error("Error loading API key:", error);
      this.apiKey = "";
    }
  }
  load() {
    console.log("obsidian_ocr: API model loaded.");
  }
  start() {
  }
  unload() {
  }
  async requestLayoutParsing(data, contentType) {
    const payload = {
      file: `data:${contentType};base64,${data.toString("base64")}`,
      model: HF_ROUTER_MODEL
    };
    const response = await (0, import_obsidian3.requestUrl)({
      url: HF_LAYOUT_PARSING_URL,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Accept": "application/json"
      },
      contentType: "application/json",
      body: JSON.stringify(payload)
    });
    if (response.json !== void 0) {
      return response.json;
    }
    if (response.text) {
      return JSON.parse(response.text);
    }
    throw new Error("Empty response from Hugging Face API");
  }
  ensureReadableFile(filepath) {
    if (!filepath.trim()) {
      throw new Error("No file path provided");
    }
    if (!fs3.existsSync(filepath)) {
      throw new Error(`File does not exist: ${filepath}`);
    }
    const stat = fs3.statSync(filepath);
    if (!stat.isFile()) {
      throw new Error(`Selected path is not a file: ${filepath}`);
    }
  }
  normalizeInputPath(filepath) {
    let normalized = (filepath != null ? filepath : "").trim();
    if (!normalized) {
      return "";
    }
    normalized = normalized.replace(/^['"]+|['"]+$/g, "");
    if (!normalized) {
      return "";
    }
    if (normalized.toLowerCase().startsWith("file://")) {
      try {
        const url = new URL(normalized);
        normalized = decodeURIComponent(url.pathname);
        if (/^\/[A-Za-z]:\//.test(normalized)) {
          normalized = normalized.substring(1);
        }
      } catch (e) {
      }
    }
    normalized = normalized.trim();
    if (!normalized) {
      return "";
    }
    return path3.normalize(normalized);
  }
  async imgfileToLatex(filepath) {
    var _a2, _b2;
    const resolvedPath = this.normalizeInputPath(filepath);
    this.ensureReadableFile(resolvedPath);
    const file = path3.parse(resolvedPath);
    const notice = new import_obsidian3.Notice(`\u2699\uFE0F Generating Latex for ${file.base}...`, 0);
    const contentType = getImageContentType(resolvedPath);
    if (!SUPPORTED_LAYOUT_PARSING_TYPES.includes(contentType)) {
      throw new Error(`Unsupported file type: ${contentType}. Supported: JPG, PNG, PDF`);
    }
    const data = fs3.readFileSync(resolvedPath);
    console.log(`obsidian_ocr: sending ${file.base} (${data.length} bytes) to Hugging Face API`);
    try {
      const response = await this.requestLayoutParsing(data, contentType);
      const routerError = extractRouterError(response);
      if (routerError) {
        throw new Error(`Hugging Face router error: ${routerError}`);
      }
      console.debug(`obsidian_ocr: API response received for ${file.base}`);
      setTimeout(() => notice.hide(), 1e3);
      const latex = typeof response === "string" ? response : extractLayoutText(response) || (response == null ? void 0 : response.generated_text) || ((_a2 = response == null ? void 0 : response[0]) == null ? void 0 : _a2.generated_text) || (response == null ? void 0 : response.text) || ((_b2 = response == null ? void 0 : response.result) == null ? void 0 : _b2.text) || (response == null ? void 0 : response.output_text);
      if (latex) {
        return latex;
      } else {
        throw new Error(`Malformed response from ${HF_OCR_MODEL}: ${JSON.stringify(response)}`);
      }
    } catch (error) {
      setTimeout(() => notice.hide(), 1e3);
      console.error(`obsidian_ocr: API request failed for ${file.base}: ${error}`);
      throw error;
    }
  }
  async status() {
    const now = Date.now();
    if (this.apiKey === "") {
      console.warn("obsidian_ocr: status check - API key required");
      return { status: 4 /* Misconfigured */, msg: "API key required", lastChecked: now };
    }
    if (this.unreachableCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      if (now - this.lastUnreachableTime < this.CIRCUIT_BREAKER_TIMEOUT_MS) {
        console.debug(`obsidian_ocr: circuit breaker open for API (count: ${this.unreachableCount})`);
        return {
          status: 3 /* Unreachable */,
          msg: "API temporarily unavailable (circuit breaker open)",
          lastChecked: now
        };
      }
      this.unreachableCount = 0;
    }
    if (this.cachedStatus && now - this.cachedStatus.timestamp < this.STATUS_CACHE_TTL_MS) {
      return this.cachedStatus;
    }
    try {
      await (0, import_obsidian3.requestUrl)({
        url: "https://huggingface.co/api/whoami-v2",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        method: "GET"
      });
      this.unreachableCount = 0;
      this.cachedStatus = { status: 0 /* Ready */, msg: "API key is working", timestamp: now };
      console.debug("obsidian_ocr: status check - API key is valid");
      return { status: 0 /* Ready */, msg: "API key is working", lastChecked: now };
    } catch (response) {
      this.lastUnreachableTime = now;
      this.unreachableCount++;
      this.cachedStatus = { status: 3 /* Unreachable */, msg: `API error: ${(response == null ? void 0 : response.status) || response}`, timestamp: now };
      if ((response == null ? void 0 : response.status) === 400 || (response == null ? void 0 : response.status) === 401) {
        console.warn(`obsidian_ocr: status check - unauthorized API key`);
        return { status: 4 /* Misconfigured */, msg: "Unauthorized: check your API key in the settings", lastChecked: now };
      }
      console.warn(`obsidian_ocr: status check - API unreachable (${(response == null ? void 0 : response.status) || response})`);
      return { status: 3 /* Unreachable */, msg: `Got ${(response == null ? void 0 : response.status) || response}`, lastChecked: now };
    }
  }
};

// src/settings.ts
var import_obsidian4 = require("obsidian");
var import_path = require("path");
var obfuscateApiKey = (apiKey = "") => apiKey.length > 0 ? apiKey.replace(/^(.{3})(.*)(.{4})$/, "$1****$3") : "";
var ObsidianOCRSettingsTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const getLocalBackendLabel = () => this.plugin.settings.localBackend === "llama.cpp" ? "llama.cpp" : "Ollama";
    let saveDebounceId = null;
    const saveSettingsDebounced = () => {
      if (saveDebounceId !== null) {
        window.clearTimeout(saveDebounceId);
      }
      saveDebounceId = window.setTimeout(() => {
        this.plugin.saveSettings();
        saveDebounceId = null;
      }, 250);
    };
    containerEl.empty();
    new import_obsidian4.Setting(containerEl).setName("Show status bar").setDesc("\u2705 online / \u2699\uFE0F loading / \u{1F310} downloading / \u{1F527} needs configuration / \u274C unreachable").addToggle((toggle) => toggle.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
      if (value) {
        this.plugin.statusBar.show();
      } else {
        this.plugin.statusBar.hide();
      }
      this.plugin.settings.showStatusBar = value;
      await this.plugin.saveSettings();
    }));
    const customPromptSetting = new import_obsidian4.Setting(containerEl).setName("Custom prompt").setDesc("Prompt sent to the vision OCR model when OCR Mode is set to 'Custom'.").addText((text) => text.setPlaceholder("Text Recognition:").setValue(this.plugin.settings.customPrompt || "").onChange((value) => {
      this.plugin.settings.customPrompt = value;
      saveSettingsDebounced();
    }));
    const refreshCustomPromptVisibility = () => {
      if (this.plugin.settings.ocrMode === "custom") {
        customPromptSetting.settingEl.show();
      } else {
        customPromptSetting.settingEl.hide();
      }
    };
    new import_obsidian4.Setting(containerEl).setName("OCR mode").setDesc("Choose parsing strategy: 'Auto-detect' intelligently classifies and extracts documents, formulas, tables, or generates detailed descriptions for charts and diagrams.").addDropdown((dropdown) => dropdown.addOption("auto", "Auto-detect (Smart: Text, Formulas, Tables, or Chart/Image Description)").addOption("describe", "Describe Image / Chart / Diagram").addOption("document", "Full Document (Markdown & LaTeX)").addOption("formulas", "Math Formulas Only (LaTeX)").addOption("text", "Plain Text Only").addOption("tables", "Tables (Markdown Table Format)").addOption("custom", "Custom Prompt").setValue(this.plugin.settings.ocrMode || "auto").onChange(async (value) => {
      this.plugin.settings.ocrMode = value;
      refreshCustomPromptVisibility();
      await this.plugin.saveSettings();
    }));
    refreshCustomPromptVisibility();
    new import_obsidian4.Setting(containerEl).setName("Max image dimension (pixels)").setDesc("Downscale oversized images proportionally to fit this dimension. Dramatically conserves VRAM and speeds up inference on GPUs with 2GB-4GB (1536 recommended, 0 to disable).").addText((text) => {
      var _a2;
      return text.setPlaceholder("1536").setValue(String((_a2 = this.plugin.settings.maxImageDimension) != null ? _a2 : 1536)).onChange((value) => {
        const parsed = parseInt(value.trim(), 10);
        this.plugin.settings.maxImageDimension = isNaN(parsed) ? 1536 : Math.max(0, parsed);
        saveSettingsDebounced();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("In-memory clipboard processing").setDesc("Process clipboard images directly in RAM without saving temporary image files to disk.").addToggle((toggle) => {
      var _a2;
      return toggle.setValue((_a2 = this.plugin.settings.inMemoryClipboard) != null ? _a2 : true).onChange(async (value) => {
        this.plugin.settings.inMemoryClipboard = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("Low-VRAM optimization preset").setDesc("Configure recommended performance settings for 2GB-4GB GPUs (1536px downscale, in-memory clipboard pipeline, and llama.cpp GLM-OCR args).").addButton((button) => button.setButtonText("Apply Low-VRAM Preset").setCta().onClick(async () => {
      this.plugin.settings.maxImageDimension = 1536;
      this.plugin.settings.inMemoryClipboard = true;
      this.plugin.settings.useLocalModel = true;
      this.plugin.settings.localBackend = "llama.cpp";
      this.plugin.settings.llamaCppPath = "llama-server";
      this.plugin.settings.llamaCppArgs = "-hf ggml-org/GLM-OCR-GGUF -ngl 99 -c 4096 --sleep-idle-seconds 300";
      await this.plugin.saveSettings();
      new import_obsidian4.Notice("\u26A1 Low-VRAM preset applied! Reloading settings view...");
      this.display();
    }));
    new import_obsidian4.Setting(containerEl).setName("Use local model").setDesc("Use a local model backend (Ollama or llama.cpp). See the project's README for installation instructions.").addToggle((toggle) => toggle.setValue(this.plugin.settings.useLocalModel).onChange(async (value) => {
      if (this.plugin.model) {
        this.plugin.model.unload();
      }
      if (value) {
        this.plugin.model = new LocalModel(this.plugin.settings);
        configuration_text.setText(getLocalConfText());
        ApiSettings.forEach((e) => e.hide());
        LocalSettings.forEach((e) => e.show());
      } else {
        this.plugin.model = new ApiModel(this.plugin.settings);
        configuration_text.setText(API_CONF_TEXT);
        ApiSettings.forEach((e) => e.show());
        LocalSettings.forEach((e) => e.hide());
      }
      this.plugin.model.load();
      this.plugin.settings.useLocalModel = value;
      await this.plugin.saveSettings();
    }));
    const checkStatus = () => {
      this.plugin.model.status().then((status) => {
        switch (status.status) {
          case 0 /* Ready */:
            new import_obsidian4.Notice("\u2705 The server is reachable!");
            break;
          case 2 /* Downloading */:
            new import_obsidian4.Notice(`\u{1F310} ${status.msg}`);
            break;
          case 1 /* Loading */:
            new import_obsidian4.Notice(`\u2699\uFE0F ${status.msg}`);
            break;
          case 4 /* Misconfigured */:
            new import_obsidian4.Notice(`\u{1F527} ${status.msg}`);
            break;
          case 3 /* Unreachable */:
          default:
            new import_obsidian4.Notice(`\u274C ${status.msg}`);
            break;
        }
      });
    };
    new import_obsidian4.Setting(containerEl).setName("Debug logging").setDesc("To enable verbose logging, open the developer console (Ctrl+Shift+I) and set the log level to include 'Verbose' messages.");
    const API_CONF_TEXT = "HuggingFace API Configuration";
    const getLocalConfText = () => `Local ${getLocalBackendLabel()} Model Configuration`;
    const configuration_setting = new import_obsidian4.Setting(containerEl).setName(API_CONF_TEXT).setHeading();
    const configuration_text = {
      setText: (text) => configuration_setting.setName(text)
    };
    if (this.plugin.settings.useLocalModel) {
      configuration_text.setText(getLocalConfText());
    }
    const KeyDisplay = new import_obsidian4.Setting(containerEl).setName("Current API Key").addText((text) => text.setPlaceholder(this.plugin.settings.obfuscatedKey).setDisabled(true));
    const apiKeyDesc = new DocumentFragment();
    apiKeyDesc.textContent = "Hugging face API key. See the ";
    apiKeyDesc.createEl("a", { text: "hugging face docs", href: "https://huggingface.co/docs/api-inference/quicktour#get-your-api-token" });
    apiKeyDesc.createSpan({ text: " on how to generate it." });
    const apiKeyInput = new import_obsidian4.Setting(containerEl).setName("Set API Key").setDesc(apiKeyDesc).addText((text) => text.inputEl.setAttr("type", "password"));
    apiKeyInput.addButton((btn) => btn.setButtonText("Submit").setCta().onClick(async (evt) => {
      const value = apiKeyInput.components[0].getValue();
      let key;
      if (safeStorage_default.isEncryptionAvailable()) {
        key = safeStorage_default.encryptString(value);
      } else {
        key = value;
      }
      new import_obsidian4.Notice("\u{1F527} Api key saved");
      this.plugin.settings.obfuscatedKey = obfuscateApiKey(value);
      this.plugin.settings.hfApiKey = key;
      KeyDisplay.components[0].setPlaceholder(this.plugin.settings.obfuscatedKey);
      await this.plugin.saveSettings();
    }));
    const ApiSettings = [apiKeyInput.settingEl, KeyDisplay.settingEl];
    const localBackend = new import_obsidian4.Setting(containerEl).setName("Local backend").setDesc("Choose which local backend to use for OCR.").addDropdown((dropdown) => dropdown.addOption("ollama", "Ollama").addOption("llama.cpp", "llama.cpp").setValue(this.plugin.settings.localBackend).onChange(async (value) => {
      this.plugin.settings.localBackend = value === "llama.cpp" ? "llama.cpp" : "ollama";
      configuration_text.setText(getLocalConfText());
      refreshLocalBackendControls();
      await this.plugin.saveSettings();
    }));
    const ollamaPath = new import_obsidian4.Setting(containerEl).setName("Ollama command/path").setDesc("Command or full path used to run Ollama. Usually `ollama` if it is available in PATH.").addExtraButton((cb) => cb.setIcon("folder").setTooltip("Browse").onClick(async () => {
      const file = await picker("Open Ollama executable", ["openFile"]);
      ollamaPath.components[1].setValue(file);
      this.plugin.settings.ollamaPath = (0, import_path.normalize)(file);
      saveSettingsDebounced();
    })).addText((text) => text.setPlaceholder("ollama").setValue(this.plugin.settings.ollamaPath).onChange((value) => {
      this.plugin.settings.ollamaPath = (0, import_path.normalize)(value);
      saveSettingsDebounced();
    }));
    const ollamaHost = new import_obsidian4.Setting(containerEl).setName("Ollama host").setDesc("Base URL for Ollama, without port. Usually http://127.0.0.1").addText((text) => text.setValue(this.plugin.settings.ollamaHost).onChange((value) => {
      this.plugin.settings.ollamaHost = value.trim();
      saveSettingsDebounced();
    }));
    const ollamaPort = new import_obsidian4.Setting(containerEl).setName("Ollama port").setDesc("Port where the Ollama API is exposed.").addText((text) => text.setValue(this.plugin.settings.ollamaPort).onChange((value) => {
      this.plugin.settings.ollamaPort = value.trim();
      saveSettingsDebounced();
    }));
    const ollamaModel = new import_obsidian4.Setting(containerEl).setName("Ollama model").setDesc("Model name installed in Ollama (example: glm-ocr).").addText((text) => text.setValue(this.plugin.settings.ollamaModel).onChange((value) => {
      this.plugin.settings.ollamaModel = value.trim();
      saveSettingsDebounced();
    }));
    const llamaCppPath = new import_obsidian4.Setting(containerEl).setName("llama.cpp command/path").setDesc("Command or full path used to run llama-server. Usually `llama-server` if it is available in PATH.").addExtraButton((cb) => cb.setIcon("folder").setTooltip("Browse").onClick(async () => {
      const file = await picker("Open llama.cpp executable", ["openFile"]);
      llamaCppPath.components[1].setValue(file);
      this.plugin.settings.llamaCppPath = (0, import_path.normalize)(file);
      saveSettingsDebounced();
    })).addText((text) => text.setPlaceholder("llama-server").setValue(this.plugin.settings.llamaCppPath).onChange((value) => {
      this.plugin.settings.llamaCppPath = (0, import_path.normalize)(value);
      saveSettingsDebounced();
    }));
    const llamaCppHost = new import_obsidian4.Setting(containerEl).setName("llama.cpp host").setDesc("Base URL for llama.cpp, without port. Usually http://127.0.0.1").addText((text) => text.setValue(this.plugin.settings.llamaCppHost).onChange((value) => {
      this.plugin.settings.llamaCppHost = value.trim();
      saveSettingsDebounced();
    }));
    const llamaCppPort = new import_obsidian4.Setting(containerEl).setName("llama.cpp port").setDesc("Port where the llama.cpp server API is exposed.").addText((text) => text.setValue(this.plugin.settings.llamaCppPort).onChange((value) => {
      this.plugin.settings.llamaCppPort = value.trim();
      saveSettingsDebounced();
    }));
    const llamaCppArgs = new import_obsidian4.Setting(containerEl).setName("llama.cpp startup args").setDesc("Arguments passed to llama-server on startup (example: -hf ggml-org/GLM-OCR-GGUF --sleep-idle-seconds 300).").addText((text) => text.setPlaceholder("-hf ggml-org/GLM-OCR-GGUF --sleep-idle-seconds 300").setValue(this.plugin.settings.llamaCppArgs).onChange((value) => {
      this.plugin.settings.llamaCppArgs = value.trim();
      saveSettingsDebounced();
    }));
    const serverStatus = new import_obsidian4.Setting(containerEl).setName("Local backend control").setDesc("Use these controls to check status or start/stop the selected local backend process from Obsidian.").addButton(
      (button) => button.setButtonText("Check status").setCta().onClick((evt) => {
        checkStatus();
      })
    ).addButton((button) => button.setButtonText("(Re)start backend").onClick(async (evt) => {
      new import_obsidian4.Notice(`\u2699\uFE0F Starting ${getLocalBackendLabel()}...`, 5e3);
      if (this.plugin.model) {
        this.plugin.model.unload();
        this.plugin.model.load();
        this.plugin.model.start();
      }
    })).addButton((button) => button.setButtonText("Stop server").onClick(async (evt) => {
      if (this.plugin.model) {
        this.plugin.model.unload();
        new import_obsidian4.Notice(`\u2699\uFE0F ${getLocalBackendLabel()} process stopped`, 2e3);
      } else {
        new import_obsidian4.Notice("\u274C No local process found to stop", 5e3);
      }
    }));
    const OllamaSettings = [
      ollamaPath.settingEl,
      ollamaHost.settingEl,
      ollamaPort.settingEl,
      ollamaModel.settingEl
    ];
    const LlamaCppSettings = [
      llamaCppPath.settingEl,
      llamaCppHost.settingEl,
      llamaCppPort.settingEl,
      llamaCppArgs.settingEl
    ];
    const LocalSettings = [
      localBackend.settingEl,
      ...OllamaSettings,
      ...LlamaCppSettings,
      serverStatus.settingEl
    ];
    const refreshLocalBackendControls = () => {
      const useLlamaCpp = this.plugin.settings.localBackend === "llama.cpp";
      if (useLlamaCpp) {
        OllamaSettings.forEach((e) => e.hide());
        LlamaCppSettings.forEach((e) => e.show());
      } else {
        LlamaCppSettings.forEach((e) => e.hide());
        OllamaSettings.forEach((e) => e.show());
      }
    };
    refreshLocalBackendControls();
    if (this.plugin.settings.useLocalModel) {
      ApiSettings.forEach((e) => e.hide());
    } else {
      LocalSettings.forEach((e) => e.hide());
    }
  }
};

// src/main.ts
var DEFAULT_SETTINGS = {
  ocrMode: "auto",
  customPrompt: "Text Recognition:",
  maxImageDimension: 1536,
  inMemoryClipboard: true,
  pythonPath: "python3",
  cacheDirPath: "",
  ollamaPath: "ollama",
  localBackend: "ollama",
  llamaCppHost: "http://127.0.0.1",
  llamaCppPort: "8080",
  llamaCppPath: "llama-server",
  llamaCppArgs: "-hf ggml-org/GLM-OCR-GGUF --sleep-idle-seconds 300",
  ollamaHost: "http://127.0.0.1",
  ollamaPort: "11434",
  ollamaModel: "glm-ocr",
  port: "50051",
  showStatusBar: true,
  useLocalModel: false,
  hfApiKey: "",
  obfuscatedKey: ""
};
var IMG_EXTS2 = ["png", "jpg", "jpeg", "bmp", "dib", "eps", "gif", "ppm", "pbm", "pgm", "pnm", "webp"];
var PDF_EXT2 = "pdf";
var SUPPORTED_EXTS2 = [...IMG_EXTS2, PDF_EXT2];
var ObsidianOCR = class extends import_obsidian5.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ObsidianOCRSettingsTab(this.app, this));
    if (this.app.vault.adapter instanceof import_obsidian5.FileSystemAdapter) {
      this.vaultPath = this.app.vault.adapter.getBasePath();
    }
    if (this.manifest.dir) {
      this.pluginPath = this.manifest.dir;
    }
    if (this.settings.cacheDirPath === "") {
      this.settings.cacheDirPath = path4.resolve(this.pluginPath, "model_cache");
      await this.saveSettings();
    }
    if (this.settings.useLocalModel) {
      this.model = new LocalModel(this.settings);
    } else {
      this.model = new ApiModel(this.settings);
    }
    this.model.load();
    try {
      await fs4.promises.mkdir(path4.join(this.vaultPath, this.pluginPath, "/.clipboard_images/"));
    } catch (err) {
      if (!err.message.includes("EEXIST")) {
        console.error(err);
      }
    }
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian5.TFile && SUPPORTED_EXTS2.includes(file.extension)) {
          menu.addItem((item) => {
            item.setTitle("Generate Formula").setIcon("sigma").setSection("info").onClick(async () => {
              this.model.imgfileToLatex(path4.join(this.vaultPath, file.path)).then(
                async (latex) => {
                  const normalizedLatex = normalizeMathForObsidian(latex);
                  try {
                    await copyToClipboard(normalizedLatex);
                  } catch (err) {
                    console.error(err);
                    new import_obsidian5.Notice(`\u26A0\uFE0F Couldn't copy to clipboard because document isn't focused`);
                  }
                  new import_obsidian5.Notice(`\u{1FA84} Latex copied to clipboard`);
                }
              ).catch((err) => {
                new import_obsidian5.Notice(`\u26A0\uFE0F ${err}`);
              });
            });
          });
        }
      })
    );
    this.addRibbonIcon("sigma", "Obsidian OCR", (evt) => {
      new ObsidianOCRModal(this.app, this).open();
    });
    this.addCommand({
      id: "paste-formula-from-clipboard-image",
      name: "Paste formula from clipboard image",
      editorCallback: (editor, ctx) => {
        this.clipboardToText(editor).catch((err) => {
          new import_obsidian5.Notice(`\u274C ${err.message}`);
          console.error(err.name, err.message);
        });
      }
    });
    this.addCommand({
      id: "restart-local-ocr-service",
      name: "(Re)start local OCR service",
      callback: async () => {
        new import_obsidian5.Notice("\u2699\uFE0F Starting local OCR service...", 5e3);
        if (this.model) {
          this.model.unload();
          this.model.load();
          this.model.start();
        }
      }
    });
    this.addCommand({
      id: "stop-local-ocr-service",
      name: "Stop local OCR service",
      callback: async () => {
        if (this.model) {
          this.model.unload();
        }
      }
    });
    this.statusBar = new StatusBar(this);
  }
  onunload() {
    var _a2;
    (_a2 = this.model) == null ? void 0 : _a2.unload();
    this.statusBar.stop();
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    delete this.settings.startServerOnLoad;
  }
  async saveSettings() {
    if (this.model) {
      this.model.reloadSettings(this.settings);
    }
    await this.saveData(this.settings);
  }
  // Get a clipboard file, save it to disk temporarily,
  // call the OCR backend.
  async clipboardToText(editor) {
    const file = await navigator.clipboard.read();
    if (file.length === 0) {
      throw new Error("Couldn't find image in clipboard");
    }
    let filetype = null;
    for (const ext of IMG_EXTS2) {
      if (file[0].types.includes(`image/${ext}`)) {
        console.debug(`obsidian_ocr: found image in clipboard with mimetype image/${ext}`);
        filetype = ext;
        break;
      }
    }
    if (filetype === null) {
      throw new Error("Couldn't find image in clipboard");
    }
    const status = await this.model.status();
    if (status.status === 3 /* Unreachable */) {
      console.warn(`obsidian_ocr: backend unreachable, trying auto-start before OCR: ${status.msg}`);
      this.model.start();
    } else if (status.status === 4 /* Misconfigured */) {
      throw new Error(status.msg);
    }
    const from = editor.getCursor("from");
    console.debug(`obsidian_ocr: received paste command at line ${from.line}`);
    const waitMessage = `\\LaTeX \\text{ is being generated... } \\vphantom{${from.line}}`;
    const fullMessage = `$$${waitMessage}$$`;
    editor.replaceSelection(fullMessage);
    const blob = await file[0].getType(`image/${filetype}`);
    const buffer = Buffer.from(await blob.arrayBuffer());
    const imgpath = path4.join(this.vaultPath, this.pluginPath, `/.clipboard_images/pasted_image.${filetype}`);
    fs4.writeFileSync(imgpath, buffer);
    let latex;
    try {
      latex = await this.model.imgfileToLatex(imgpath);
      latex = normalizeMathForObsidian(latex);
    } catch (err) {
      latex = "";
      new import_obsidian5.Notice(`\u26A0\uFE0F ${err} `, 5e3);
      console.error(err);
    }
    const firstLine = 0;
    const lastLine = editor.lineCount() - 1;
    let currLine = from.line;
    while (currLine <= lastLine) {
      const text = editor.getLine(currLine);
      const from2 = text.indexOf(fullMessage);
      if (from2 !== -1) {
        editor.replaceRange(latex, { line: currLine, ch: from2 }, { line: currLine, ch: from2 + fullMessage.length });
        if (latex !== "") {
          new import_obsidian5.Notice(`\u{1FA84} Latex pasted to note`);
        }
        return;
      }
      currLine += 1;
    }
    currLine = from.line - 1;
    while (currLine >= firstLine) {
      const text = editor.getLine(currLine);
      const from2 = text.indexOf(fullMessage);
      if (from2 !== -1) {
        editor.replaceRange(latex, { line: currLine, ch: from2 }, { line: currLine, ch: from2 + fullMessage.length });
        if (latex !== "") {
          new import_obsidian5.Notice(`\u{1FA84} Latex pasted to note`);
        }
        return;
      }
      currLine -= 1;
    }
    throw new Error("Couldn't find paste target");
  }
};
