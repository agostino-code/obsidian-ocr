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

type OllamaChatResponse = {
    message?: {
        content?: string;
    };
};

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
        const d = this.plugin_settings.delimiters;

        try {
            const response = await requestUrl({
                url: `${this.getOllamaBaseUrl()}/api/chat`,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: this.plugin_settings.ollamaModel,
                    stream: false,
                    messages: [
                        {
                            role: "user",
                            content: "Extract only LaTeX from this image. Return just the LaTeX expression without explanations.",
                            images: [imageB64],
                        },
                    ],
                }),
            });

            const result = response.json as OllamaChatResponse;
            const latex = result.message?.content?.trim();

            if (!latex) {
                throw new Error(`Malformed response from Ollama: ${JSON.stringify(result)}`);
            }

            return `${d}${latex}${d}`;
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