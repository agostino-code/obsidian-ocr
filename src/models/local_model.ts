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

const OLLAMA_OCR_TIMEOUT_MS = 180000;
const OLLAMA_OCR_RETRIES = 3;
const OLLAMA_OCR_RETRY_DELAY_MS = 5000;
const OLLAMA_OCR_PROMPT = "Text Recognition:";

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
        console.log(`obsidian_ocr: local Ollama model loaded (${this.plugin_settings.ollamaModel})`);
    }

    unload() {
        this.killServer();
    }

    private getOllamaBaseUrl() {
        const host = this.plugin_settings.ollamaHost.replace(/\/$/, "");
        return `${host}:${this.plugin_settings.ollamaPort}`;
    }

    private killServer() {
        if (!this.serverProcess) {
            return;
        }

        try {
            this.serverProcess.kill();
            console.log(`obsidian_ocr: stopped spawned ollama process (PID: ${this.serverProcess.pid})`);
        } catch (err) {
            console.debug(`obsidian_ocr: failed to stop ollama process`, err);
        }

        this.serverProcess = undefined;
    }

    private async isOllamaReachable() {
        try {
            const response = await requestUrl({
                url: `${this.getOllamaBaseUrl()}/api/version`,
                method: "GET",
            });
            return response.status >= 200 && response.status < 300;
        } catch (_) {
            return false;
        }
    }

    private async getInstalledModels() {
        const response = await requestUrl({
            url: `${this.getOllamaBaseUrl()}/api/tags`,
            method: "GET",
        });

        const tags = response.json as OllamaTagResponse;
        return (tags.models ?? [])
            .map((model) => model.name?.toLowerCase())
            .filter((name): name is string => !!name);
    }

    private async getLoadedModels() {
        const response = await requestUrl({
            url: `${this.getOllamaBaseUrl()}/api/ps`,
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

    private checkOllamaInstallation() {
        return new Promise<void>((resolve, reject) => {
            const process = spawn(this.plugin_settings.ollamaPath, ["--version"]);

            process.on("close", (code: number | null) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Ollama was found at '${this.plugin_settings.ollamaPath}' but failed to run.`));
                }
            });

            process.on("error", (err: Error) => {
                if (`${err}`.includes("ENOENT")) {
                    reject(new Error(`Could not find Ollama command '${this.plugin_settings.ollamaPath}'.`));
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

        try {
            try {
                const loadedModels = await this.getLoadedModels();
                if (!this.isConfiguredModelInList(loadedModels)) {
                    new Notice(`⚙️ Model '${this.plugin_settings.ollamaModel}' is not loaded yet. Warming up...`, 4000);
                }
            } catch (psError) {
                // Keep OCR flow resilient even if /api/ps is temporarily unavailable.
                console.warn("obsidian_ocr: preliminary /api/ps check failed", psError);
            }

            let lastError: unknown;
            for (let attempt = 1; attempt <= OLLAMA_OCR_RETRIES; attempt++) {
                try {
                    if (attempt > 1) {
                        notice.setMessage(`⚙️ Generating Latex for ${file.base}... retry ${attempt}/${OLLAMA_OCR_RETRIES}`)
                    }

                    const response = await this.withTimeout(
                        requestUrl({
                            url: `${this.getOllamaBaseUrl().replace(/\/$/, "")}/api/chat`,
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
                } catch (error) {
                    lastError = error;
                    const isLast = attempt === OLLAMA_OCR_RETRIES;
                    console.warn(`obsidian_ocr: Ollama OCR attempt ${attempt}/${OLLAMA_OCR_RETRIES} failed`, error);
                    if (!isLast) {
                        await this.sleep(OLLAMA_OCR_RETRY_DELAY_MS);
                    }
                }
            }

            throw new Error(`Ollama OCR failed after ${OLLAMA_OCR_RETRIES} attempts: ${lastError}`);
        } finally {
            setTimeout(() => notice.hide(), 1000);
        }
    }

    async status() {
        try {
            const reachable = await this.isOllamaReachable();
            if (!reachable) {
                await this.checkOllamaInstallation();
                return {
                    status: Status.Unreachable,
                    msg: `Ollama is not reachable at ${this.getOllamaBaseUrl()}.`,
                };
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
        const reachable = await this.isOllamaReachable();
        if (reachable) {
            console.log("obsidian_ocr: Ollama already running");
            return;
        }

        try {
            this.serverProcess = await this.spawnOllamaServer();
            new Notice("⚙️ Ollama started", 3000);
        } catch (err) {
            console.error(err);
            new Notice(`❌ Could not start Ollama: ${err}`, 10000);
        }
    }
}