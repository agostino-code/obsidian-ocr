import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import { ObsidianOCRSettings } from 'main';
import Model, { Status } from 'models/model';
import { Notice, requestUrl, loadPdfJs } from 'obsidian';
import * as path from 'path';

const IMG_EXTS = ["png", "jpg", "jpeg", "bmp", "dib", "eps", "gif", "ppm", "pbm", "pgm", "pnm", "webp"];
const PDF_EXT = "pdf";
const SUPPORTED_EXTS = [...IMG_EXTS, PDF_EXT];

type OllamaTagResponse = {
    models?: Array<{ name?: string }>;
};

type OllamaPsResponse = {
    models?: Array<{ name?: string }>;
};

type OllamaChatResponse = {
    message?: {
        content?: string;
    };
    response?: string;
};

type LlamaCppChatResponse = {
    choices?: Array<{
        message?: {
            content?: string | Array<{ text?: string }>;
        };
    }>;
};

type PdfDocumentLike = {
    numPages: number;
    getPage(pageNumber: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number };
        render(params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
        cleanup(): void;
    }>;
    destroy(): Promise<void>;
};

const OLLAMA_OCR_TIMEOUT_MS = 180000;
const OLLAMA_OCR_RETRIES = 6;
const OLLAMA_OCR_RETRY_DELAY_MS = 5000;
const OLLAMA_OCR_PROMPT = "Text Recognition:";
const OLLAMA_OCR_MAX_TOKENS = 4096;
const BACKEND_STARTUP_TIMEOUT_MS = 180000; // Models can take a long time to load into VRAM
const BACKEND_STARTUP_POLL_MS = 1000;
const ARG_TOKEN_REGEX = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;

export class LocalModel implements Model {
    serverProcess?: ChildProcess;
    plugin_settings: ObsidianOCRSettings;
    statusCheckIntervalLoading = 1000;
    statusCheckIntervalReady = 5000;

    // Circuit breaker for backend reachability
    private lastUnreachableTime: number = 0;
    private unreachableCount: number = 0;
    private readonly CIRCUIT_BREAKER_THRESHOLD = 3;
    private readonly CIRCUIT_BREAKER_TIMEOUT_MS = 60000;

    // Cache last status result to avoid redundant checks
    private cachedStatus: { status: Status; msg: string; timestamp: number } | null = null;
    private readonly STATUS_CACHE_TTL_MS = 2000;

    constructor(settings: ObsidianOCRSettings) {
        this.plugin_settings = settings;
    }

    reloadSettings(settings: ObsidianOCRSettings) {
        this.plugin_settings = settings;
    }

    load() {
        const modelLabel = this.getBackendType() === "llama.cpp" ? this.plugin_settings.llamaCppArgs : this.plugin_settings.ollamaModel;
        console.log(`obsidian_ocr: local ${this.getBackendDisplayName()} model loaded (${modelLabel})`);
    }

    unload() {
        this.killServer();
    }

    private getBaseUrl() {
        const backend = this.getBackendType();
        const host = backend === "llama.cpp"
            ? this.plugin_settings.llamaCppHost
            : this.plugin_settings.ollamaHost;
        const port = backend === "llama.cpp"
            ? this.plugin_settings.llamaCppPort
            : this.plugin_settings.ollamaPort;

        return `${host.replace(/\/$/, "")}:${port}`;
    }

    private getBackendType() {
        return this.plugin_settings.localBackend === "llama.cpp" ? "llama.cpp" : "ollama";
    }

    private getBackendDisplayName() {
        return this.getBackendType() === "llama.cpp" ? "llama.cpp" : "Ollama";
    }

    private killServer() {
        if (!this.serverProcess) {
            return;
        }

        try {
            this.serverProcess.kill();
            console.log(`obsidian_ocr: stopped spawned ${this.getBackendDisplayName()} process (PID: ${this.serverProcess.pid})`);
        } catch (err) {
            console.debug(`obsidian_ocr: failed to stop ${this.getBackendDisplayName()} process`, err);
        }

        this.serverProcess = undefined;
    }

    private async isBackendReachable(forceCheck: boolean = false): Promise<boolean> {
        const now = Date.now();

        // Check circuit breaker
        if (!forceCheck && this.unreachableCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
            if (now - this.lastUnreachableTime < this.CIRCUIT_BREAKER_TIMEOUT_MS) {
                console.debug(`obsidian_ocr: circuit breaker open, skipping reachability check (count: ${this.unreachableCount})`);
                return false;
            }
            // Reset circuit breaker after timeout
            this.unreachableCount = 0;
        }

        // Check cache
        if (!forceCheck && this.cachedStatus && (now - this.cachedStatus.timestamp < this.STATUS_CACHE_TTL_MS)) {
            return this.cachedStatus.status === Status.Ready;
        }

        const baseUrl = this.getBaseUrl();
        const backend = this.getBackendType();

        const urls = backend === "llama.cpp"
            ? [`${baseUrl}/health`, `${baseUrl}/v1/models`]
            : [`${baseUrl}/api/version`];

        for (const url of urls) {
            try {
                const response = await requestUrl({
                    url,
                    method: "GET",
                });
                if (response.status >= 200 && response.status < 300) {
                    // Cache success
                    this.cachedStatus = { status: Status.Ready, msg: "Backend reachable", timestamp: now };
                    this.unreachableCount = 0;
                    return true;
                }
            } catch (err) {
                console.debug(`obsidian_ocr: backend check failed for ${url}: ${err}`);
            }
        }

        // Cache failure and update circuit breaker
        this.lastUnreachableTime = now;
        this.unreachableCount++;
        this.cachedStatus = { status: Status.Unreachable, msg: "Backend not reachable", timestamp: now };
        console.debug(`obsidian_ocr: backend unreachable (count: ${this.unreachableCount}/${this.CIRCUIT_BREAKER_THRESHOLD})`);
        return false;
    }

    private async getInstalledModels() {
        try {
            const response = await requestUrl({
                url: `${this.getBaseUrl()}/api/tags`,
                method: "GET",
            });

            const tags = response.json as OllamaTagResponse;
            return (tags.models ?? [])
                .map((model) => model.name?.toLowerCase())
                .filter((name): name is string => !!name);
        } catch {
            return [];
        }
    }

    private async getLoadedModels() {
        const response = await requestUrl({
            url: `${this.getBaseUrl()}/api/ps`,
            method: "GET",
        });

        const running = response.json as OllamaPsResponse;
        return (running.models ?? [])
            .map((model) => model.name?.toLowerCase())
            .filter((name): name is string => !!name);
    }

    private isConfiguredModelInList(models: string[]) {
        const configuredModel = this.plugin_settings.ollamaModel.toLowerCase();
        return models.some((name) => {
            const base = name.split(":")[0];
            const configuredBase = configuredModel.split(":")[0];
            return name === configuredModel
                || name === `${configuredModel}:latest`
                || base === configuredBase;
        });
    }

    private checkBackendInstallation() {
        const backend = this.getBackendType();
        const command = backend === "llama.cpp"
            ? this.plugin_settings.llamaCppPath
            : this.plugin_settings.ollamaPath;

        return new Promise<void>((resolve, reject) => {
            const process = spawn(command, ["--version"]);

            process.on("close", (code: number | null) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`${this.getBackendDisplayName()} was found at '${command}' but failed to run.`));
                }
            });

            process.on("error", (err: Error) => {
                if (`${err}`.includes("ENOENT")) {
                    reject(new Error(`Could not find ${this.getBackendDisplayName()} command '${command}'.`));
                } else {
                    reject(new Error(`${err}`));
                }
            });
        });
    }

    private spawnOllamaServer(): Promise<ChildProcess> {
        return new Promise<ChildProcess>((resolve, reject) => {
            const process = spawn(this.plugin_settings.ollamaPath, ["serve"]);

            process.on("spawn", () => {
                console.log(`obsidian_ocr: spawned ollama serve (PID: ${process.pid})`);
                resolve(process);
            });

            process.on("error", (err: Error) => {
                reject(err);
            });

            process.stdout?.on("data", (data: Buffer) => {
                console.debug(`ollama: ${data.toString()}`);
            });

            process.stderr?.on("data", (data: Buffer) => {
                console.debug(`ollama: ${data.toString()}`);
            });

            process.on("close", (code: number | null) => {
                console.log(`obsidian_ocr: ollama serve exited (${code})`);
                if (this.serverProcess?.pid === process.pid) {
                    this.serverProcess = undefined;
                }
            });
        });
    }

    private parseArgs(rawArgs: string) {
        const args: string[] = [];
        const trimmed = rawArgs.trim();
        if (!trimmed) {
            return args;
        }

        for (const match of trimmed.matchAll(ARG_TOKEN_REGEX)) {
            const token = match[1] ?? match[2] ?? match[0];
            args.push(token);
        }

        return args;
    }

    private spawnLlamaCppServer(): Promise<ChildProcess> {
        return new Promise<ChildProcess>((resolve, reject) => {
            const args = this.parseArgs(this.plugin_settings.llamaCppArgs);
            const process = spawn(this.plugin_settings.llamaCppPath, args);

            process.on("spawn", () => {
                console.log(`obsidian_ocr: spawned llama.cpp server (PID: ${process.pid})`);
                resolve(process);
            });

            process.on("error", (err: Error) => {
                reject(err);
            });

            process.stdout?.on("data", (data: Buffer) => {
                console.debug(`llama.cpp: ${data.toString()}`);
            });

            process.stderr?.on("data", (data: Buffer) => {
                console.debug(`llama.cpp: ${data.toString()}`);
            });

            process.on("close", (code: number | null) => {
                console.log(`obsidian_ocr: llama.cpp server exited (${code})`);
                if (this.serverProcess?.pid === process.pid) {
                    this.serverProcess = undefined;
                }
            });
        });
    }

    private spawnBackendServer() {
        if (this.getBackendType() === "llama.cpp") {
            return this.spawnLlamaCppServer();
        }
        return this.spawnOllamaServer();
    }

    private sleep(ms: number) {
        return new Promise<void>((resolve) => setTimeout(resolve, ms));
    }

    private withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
            }, timeoutMs);

            promise
                .then((value) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    private extractRequestErrorMessage(error: unknown, fallbackLabel: string) {
        if (error && typeof error === "object") {
            const response = error as { response?: { text?: string; json?: unknown }; message?: string; status?: number; statusText?: string };

            if (typeof response.response?.text === "string" && response.response.text.trim()) {
                return `${fallbackLabel}: ${response.response.text.trim()}`;
            }

            if (response.response?.json && typeof response.response.json === "object") {
                return `${fallbackLabel}: ${JSON.stringify(response.response.json)}`;
            }

            if (typeof response.message === "string" && response.message.trim()) {
                const status = typeof response.status === "number" ? ` (status ${response.status}${response.statusText ? ` ${response.statusText}` : ""})` : "";
                return `${fallbackLabel}: ${response.message.trim()}${status}`;
            }
        }

        return `${fallbackLabel}: ${String(error)}`;
    }

    private async waitForBackendReachable(timeoutMs: number) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (await this.isBackendReachable()) {
                return true;
            }
            await this.sleep(BACKEND_STARTUP_POLL_MS);
        }
        return false;
    }

    private async ensureBackendReadyForOCR(notice?: Notice) {
        if (await this.isBackendReachable(true)) {
            console.log(`obsidian_ocr: backend already reachable at ${this.getBaseUrl()}`);
            return;
        }

        if (notice) {
            notice.setMessage(`🚀 Starting ${this.getBackendDisplayName()} backend...`);
        }

        console.log(`obsidian_ocr: checking ${this.getBackendDisplayName()} installation...`);
        await this.checkBackendInstallation();

        if (this.serverProcess) {
            console.log(`obsidian_ocr: waiting for existing backend to become reachable...`);
            const becameReady = await this.waitForBackendReachable(15000);
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
            throw new Error(`${this.getBackendDisplayName()} did not become reachable at ${this.getBaseUrl()} within ${Math.round(BACKEND_STARTUP_TIMEOUT_MS / 1000)}s`);
        }
        console.log(`obsidian_ocr: backend is now reachable at ${this.getBaseUrl()}`);
        
        // Give the backend a brief moment to fully initialize its inference engine
        // before we bombard it with a heavy OCR multimodal payload.
        await this.sleep(2000);
    }

    private async requestOllamaOCR(imageB64: string) {
        const response = await this.withTimeout(
            requestUrl({
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
                            images: [imageB64],
                        },
                    ],
                }),
                throw: false,
            }),
            OLLAMA_OCR_TIMEOUT_MS,
            "Ollama OCR request"
        );

        if (response.status >= 400) {
            throw new Error(`Ollama OCR request failed with status ${response.status}: ${JSON.stringify(response.json || response.text || "")}`);
        }

        const result = response.json as OllamaChatResponse;
        const latex = (result.message?.content ?? result.response ?? "").trim();

        if (!latex) {
            throw new Error(`Malformed response from Ollama: ${JSON.stringify(result)}`);
        }

        return latex;
    }

    private async requestLlamaCppOCR(imageB64: string, ext: string) {
        const response = await this.withTimeout(
            requestUrl({
                url: `${this.getBaseUrl().replace(/\/$/, "")}/v1/chat/completions`,
                method: "POST",
                contentType: "application/json",
                body: JSON.stringify({
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: OLLAMA_OCR_PROMPT },
                                { type: "image_url", image_url: { url: `data:image/${ext};base64,${imageB64}` } },
                            ],
                        },
                    ],
                    temperature: 0,
                    top_k: 1,
                    stream: false,
                    max_tokens: OLLAMA_OCR_MAX_TOKENS,
                }),
                throw: false,
            }),
            OLLAMA_OCR_TIMEOUT_MS,
            "llama.cpp OCR request"
        ).catch((error) => {
            throw new Error(this.extractRequestErrorMessage(error, "llama.cpp OCR request failed"));
        });

        if (response.status >= 400) {
            throw new Error(`llama.cpp OCR request failed with status ${response.status}: ${JSON.stringify(response.json || response.text || "")}`);
        }

        const result = response.json as LlamaCppChatResponse;
        const content = result.choices?.[0]?.message?.content;
        const latex = typeof content === "string"
            ? content.trim()
            : Array.isArray(content)
                ? content.map((item) => item?.text?.trim()).filter((part): part is string => !!part).join("\n").trim()
                : "";

        if (!latex) {
            throw new Error(`Malformed response from llama.cpp: ${JSON.stringify(result)}`);
        }

        return latex;
    }

    private async prepareBackendForOCR(notice?: Notice) {
        await this.ensureBackendReadyForOCR(notice);

        if (this.getBackendType() !== "ollama") {
            return;
        }

        try {
            const loadedModels = await this.getLoadedModels();
            if (!this.isConfiguredModelInList(loadedModels)) {
                new Notice(`⚙️ Model '${this.plugin_settings.ollamaModel}' is not loaded yet. Warming up...`, 4000);
            }
        } catch (psError) {
            // Keep OCR flow resilient even if /api/ps is temporarily unavailable.
            console.warn("obsidian_ocr: preliminary /api/ps check failed", psError);
        }
    }

    private async renderPdfPageToBase64(pdfDocument: PdfDocumentLike, pageNumber: number) {
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

    private getImageMimeType(ext: string) {
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

    private loadImage(dataUrl: string) {
        return new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("Could not decode image for OCR"));
            image.src = dataUrl;
        });
    }

    private async normalizeImageFileToPngBase64(filepath: string, ext: string) {
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

    private async ocrRenderedImage(imageB64: string, ext: string, notice: Notice, label: string) {
        const backend = this.getBackendType();
        const backendLabel = this.getBackendDisplayName();
        let lastError: unknown;

        for (let attempt = 1; attempt <= OLLAMA_OCR_RETRIES; attempt++) {
            try {
                if (attempt > 1) {
                    notice.setMessage(`⚙️ Generating Latex for ${label}... retry ${attempt}/${OLLAMA_OCR_RETRIES}`)
                    console.log(`obsidian_ocr: retrying OCR for ${label}, attempt ${attempt}/${OLLAMA_OCR_RETRIES}`);
                }

                if (backend === "llama.cpp") {
                    return await this.requestLlamaCppOCR(imageB64, ext);
                }

                return await this.requestOllamaOCR(imageB64);
            } catch (error) {
                lastError = error;
                const isLast = attempt === OLLAMA_OCR_RETRIES;

                const errorMsg = String(error);
                // Immediately abort retries on bad requests, as they won't succeed on retry
                if (errorMsg.includes("status 400") || errorMsg.includes("status 404") || errorMsg.includes("status 401")) {
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

    private async imageFileToLatex(filepath: string, notice: Notice, label: string, ext: string) {
        const backend = this.getBackendType();

        if (backend === "llama.cpp") {
            try {
                const imageB64 = await this.normalizeImageFileToPngBase64(filepath, ext);
                return await this.ocrRenderedImage(imageB64, "png", notice, label);
            } catch (error) {
                console.warn(`obsidian_ocr: image normalization failed for ${label}, falling back to raw bytes`, error);
            }
        }

        const data = fs.readFileSync(filepath);
        const imageB64 = data.toString("base64");
        return await this.ocrRenderedImage(imageB64, ext, notice, label);
    }

    private async pdfFileToLatex(filepath: string, notice: Notice, label: string) {
        const pdfData = fs.readFileSync(filepath);
        const pdfjsLib = await loadPdfJs();
        const loadingTask = (pdfjsLib as any).getDocument({ data: new Uint8Array(pdfData), disableWorker: true });
        const pdfDocument = await loadingTask.promise as PdfDocumentLike;

        try {
            const pageLatex: string[] = [];
            for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
                notice.setMessage(`⚙️ Generating Latex for ${label}... page ${pageNumber}/${pdfDocument.numPages}`);
                const imageB64 = await this.renderPdfPageToBase64(pdfDocument, pageNumber);
                const latex = await this.ocrRenderedImage(imageB64, "png", notice, `${label} page ${pageNumber}/${pdfDocument.numPages}`);
                pageLatex.push(latex);
            }

            return pageLatex.join("\n\n");
        } finally {
            await pdfDocument.destroy();
        }
    }

    private async canOpenAsPdf(filepath: string) {
        try {
            const pdfData = fs.readFileSync(filepath);
            const pdfjsLib = await loadPdfJs();
            const loadingTask = (pdfjsLib as any).getDocument({ data: new Uint8Array(pdfData), disableWorker: true });
            const pdfDocument = await loadingTask.promise as PdfDocumentLike;
            await pdfDocument.destroy();
            return true;
        } catch {
            return false;
        }
    }

    private detectFileTypeFromMagicHeader(filepath: string) {
        try {
            const handle = fs.openSync(filepath, "r");
            try {
                const buffer = Buffer.alloc(1024);
                const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
                if (bytesRead < 4) {
                    return null;
                }

                // PDF header is usually at byte 0, but some files can include a preamble.
                if (bytesRead >= 5 && buffer.toString("ascii", 0, bytesRead).includes("%PDF-")) {
                    return PDF_EXT;
                }

                // PNG: 89 50 4E 47 0D 0A 1A 0A
                if (bytesRead >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
                    return "png";
                }

                // JPEG: FF D8 FF
                if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
                    return "jpg";
                }

                // GIF: GIF87a / GIF89a
                if (bytesRead >= 6) {
                    const gifHeader = buffer.toString("ascii", 0, 6);
                    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
                        return "gif";
                    }
                }

                // BMP: 42 4D => BM
                if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
                    return "bmp";
                }

                // WEBP: RIFF....WEBP
                if (bytesRead >= 12
                    && buffer.toString("ascii", 0, 4) === "RIFF"
                    && buffer.toString("ascii", 8, 12) === "WEBP") {
                    return "webp";
                }

                return null;
            } finally {
                fs.closeSync(handle);
            }
        } catch {
            return null;
        }
    }

    private resolveInputExt(filepath: string, ext: string) {
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

    private normalizeInputPath(filepath: string) {
        let normalized = (filepath ?? "").trim();
        if (!normalized) {
            return "";
        }

        // Strip accidental wrapping quotes from copied/pasted paths.
        normalized = normalized.replace(/^['"]+|['"]+$/g, "");
        if (!normalized) {
            return "";
        }

        if (normalized.toLowerCase().startsWith("file://")) {
            try {
                const url = new URL(normalized);
                normalized = decodeURIComponent(url.pathname);
                // Windows file URLs may look like /C:/Users/...
                if (/^\/[A-Za-z]:\//.test(normalized)) {
                    normalized = normalized.substring(1);
                }
            } catch {
                // Keep original value if URL parsing fails.
            }
        }

        normalized = normalized.trim();
        if (!normalized) {
            return "";
        }

        return path.normalize(normalized);
    }

    private ensureReadableFile(filepath: string) {
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

    async imgfileToLatex(filepath: string): Promise<string> {
        const resolvedPath = this.normalizeInputPath(filepath);
        const file = path.parse(resolvedPath);
        const ext = file.ext.substring(1);

        this.ensureReadableFile(resolvedPath);

        let resolvedExt = this.resolveInputExt(resolvedPath, ext);

        const notice = new Notice(`⚙️ Analyzing ${file.base}...`, 0);

        try {
            await this.prepareBackendForOCR(notice);
            notice.setMessage(`⚙️ Generating Latex for ${file.base}...`);

            if (resolvedExt === PDF_EXT) {
                return await this.pdfFileToLatex(resolvedPath, notice, file.base);
            }

            if (!IMG_EXTS.includes(resolvedExt)) {
                const canOpenAsPdf = await this.canOpenAsPdf(resolvedPath);
                if (canOpenAsPdf) {
                    return await this.pdfFileToLatex(resolvedPath, notice, file.base);
                }

                // Last resort: some providers still parse extension-less image bytes correctly.
                resolvedExt = "png";
            }

            return await this.imageFileToLatex(resolvedPath, notice, file.base, resolvedExt);
        } finally {
            setTimeout(() => notice.hide(), 1000);
        }
    }

    async status() {
        const backend = this.getBackendType();
        const backendLabel = this.getBackendDisplayName();
        const now = Date.now();

        try {
            const reachable = await this.isBackendReachable();

            if (!reachable) {
                // Only log check failures at debug level so we do not spam consoles
                try {
                    await this.checkBackendInstallation();
                } catch(e) {
                    console.debug(`obsidian_ocr: status check - installation check failed: ${e}`);
                }
                const msg = `${backendLabel} is not reachable at ${this.getBaseUrl()}.`;
                console.debug(`obsidian_ocr: status check - ${msg}`);
                return {
                    status: Status.Unreachable,
                    msg,
                };
            }

            if (backend === "llama.cpp") {
                console.debug(`obsidian_ocr: status check - llama.cpp server ready at ${this.getBaseUrl()}`);
                return { status: Status.Ready, msg: "llama.cpp server is ready", lastChecked: now };
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
                    status: Status.Misconfigured,
                    msg,
                };
            }

            console.debug(`obsidian_ocr: status check - Ollama ready at ${this.getBaseUrl()}, model: ${this.plugin_settings.ollamaModel}`);
            return { status: Status.Ready, msg: "Ollama is ready", lastChecked: now };
        } catch (err) {
            const msg = `${err}`;
            console.debug(`obsidian_ocr: status check failed:`, err);
            return { status: Status.Misconfigured, msg };
        }
    }

    async start() {
        const backendLabel = this.getBackendDisplayName();
        // Reset circuit breaker when user explicitly starts
        this.unreachableCount = 0;
        this.cachedStatus = null;

        const reachable = await this.isBackendReachable(true);
        if (reachable) {
            console.log(`obsidian_ocr: ${backendLabel} already running`);
            return;
        }

        try {
            this.serverProcess = await this.spawnBackendServer();
            new Notice(`${backendLabel} started successfully.`, 3000);
        } catch (err) {
            console.error(err);
            new Notice(`❌ Could not start ${backendLabel}: ${err}`, 10000);
        }
    }
}