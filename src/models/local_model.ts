import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import { ObsidianOCRSettings } from 'main';
import Model, { Status } from 'models/model';
import { Notice, requestUrl } from 'obsidian';
import * as path from 'path';

const IMG_EXTS = ["png", "jpg", "jpeg", "bmp", "dib", "eps", "gif", "ppm", "pbm", "pgm", "pnm", "webp"];

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

const OLLAMA_OCR_TIMEOUT_MS = 180000;
const OLLAMA_OCR_RETRIES = 3;
const OLLAMA_OCR_RETRY_DELAY_MS = 5000;
const OLLAMA_OCR_PROMPT = "Text Recognition:";
const BACKEND_STARTUP_TIMEOUT_MS = 45000;
const BACKEND_STARTUP_POLL_MS = 1000;
const ARG_TOKEN_REGEX = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;

export class LocalModel implements Model {
    serverProcess?: ChildProcess;
    plugin_settings: ObsidianOCRSettings;
    statusCheckIntervalLoading = 1000;
    statusCheckIntervalReady = 5000;

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

    private async isBackendReachable() {
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
                    return true;
                }
            } catch {
                // Try the next health endpoint.
            }
        }

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

    private async ensureBackendReadyForOCR() {
        if (await this.isBackendReachable()) {
            return;
        }

        await this.checkBackendInstallation();

        if (this.serverProcess) {
            const becameReady = await this.waitForBackendReachable(15000);
            if (becameReady) {
                return;
            }
            this.killServer();
        }

        this.serverProcess = await this.spawnBackendServer();
        const reachable = await this.waitForBackendReachable(BACKEND_STARTUP_TIMEOUT_MS);
        if (!reachable) {
            throw new Error(`${this.getBackendDisplayName()} did not become reachable at ${this.getBaseUrl()} within ${Math.round(BACKEND_STARTUP_TIMEOUT_MS / 1000)}s`);
        }
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
            }),
            OLLAMA_OCR_TIMEOUT_MS,
            "Ollama OCR request"
        );

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
                headers: { "Content-Type": "application/json" },
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
                }),
            }),
            OLLAMA_OCR_TIMEOUT_MS,
            "llama.cpp OCR request"
        );

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

    async imgfileToLatex(filepath: string): Promise<string> {
        const file = path.parse(filepath);
        const ext = file.ext.substring(1).toLowerCase();

        if (!IMG_EXTS.includes(ext)) {
            throw new Error(`Unsupported image extension ${file.ext}`);
        }

        if (!fs.existsSync(filepath)) {
            throw new Error(`Image file does not exist: ${filepath}`);
        }

        const notice = new Notice(`⚙️ Generating Latex for ${file.base}...`, 0);
        const data = fs.readFileSync(filepath);
        const imageB64 = data.toString("base64");
        const backend = this.getBackendType();

        try {
            await this.ensureBackendReadyForOCR();

            if (backend === "ollama") {
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

            let lastError: unknown;
            for (let attempt = 1; attempt <= OLLAMA_OCR_RETRIES; attempt++) {
                try {
                    if (attempt > 1) {
                        notice.setMessage(`⚙️ Generating Latex for ${file.base}... retry ${attempt}/${OLLAMA_OCR_RETRIES}`)
                    }

                    if (backend === "llama.cpp") {
                        return await this.requestLlamaCppOCR(imageB64, ext);
                    }

                    return await this.requestOllamaOCR(imageB64);
                } catch (error) {
                    lastError = error;
                    const isLast = attempt === OLLAMA_OCR_RETRIES;
                    console.warn(`obsidian_ocr: ${this.getBackendDisplayName()} OCR attempt ${attempt}/${OLLAMA_OCR_RETRIES} failed`, error);
                    if (!isLast) {
                        await this.ensureBackendReadyForOCR();
                        await this.sleep(OLLAMA_OCR_RETRY_DELAY_MS);
                    }
                }
            }

            throw new Error(`${this.getBackendDisplayName()} OCR failed after ${OLLAMA_OCR_RETRIES} attempts: ${lastError}`);
        } finally {
            setTimeout(() => notice.hide(), 1000);
        }
    }

    async status() {
        try {
            const backend = this.getBackendType();
            const backendLabel = this.getBackendDisplayName();
            const reachable = await this.isBackendReachable();
            if (!reachable) {
                await this.checkBackendInstallation();
                return {
                    status: Status.Unreachable,
                    msg: `${backendLabel} is not reachable at ${this.getBaseUrl()}.`,
                };
            }

            if (backend === "llama.cpp") {
                return { status: Status.Ready, msg: "llama.cpp server is ready" };
            }

            const models = await this.getInstalledModels();
            const configuredModel = this.plugin_settings.ollamaModel.toLowerCase();
            const modelFound = models.some((name) => {
                return name === configuredModel || name === `${configuredModel}:latest`;
            });

            if (!modelFound) {
                return {
                    status: Status.Misconfigured,
                    msg: `Model '${this.plugin_settings.ollamaModel}' not found in Ollama. Run: ollama pull ${this.plugin_settings.ollamaModel}`,
                };
            }

            return { status: Status.Ready, msg: "Ollama is ready" };
        } catch (err) {
            return { status: Status.Misconfigured, msg: `${err}` };
        }
    }

    async start() {
        const backendLabel = this.getBackendDisplayName();
        const reachable = await this.isBackendReachable();
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