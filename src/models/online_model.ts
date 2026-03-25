import Model, { Status } from "./model";
import * as fs from 'fs'
import { ObsidianOCRSettings } from "main";
import safeStorage from "safeStorage";
import { Notice, requestUrl } from "obsidian";
import * as path from "path";

const HF_OCR_MODEL = "zai-org/GLM-OCR";
const HF_LAYOUT_PARSING_URL = "https://router.huggingface.co/zai-org/api/paas/v4/layout_parsing";
const HF_ROUTER_MODEL = "glm-ocr"
const SUPPORTED_LAYOUT_PARSING_TYPES = ["image/jpeg", "image/png", "application/pdf"]

function getImageContentType(filepath: string): string {
    const ext = path.extname(filepath).toLowerCase()
    if (ext === ".jpg" || ext === ".jpeg") {
        return "image/jpeg"
    }
    if (ext === ".png") {
        return "image/png"
    }
    if (ext === ".pdf") {
        return "application/pdf"
    }
    return "application/octet-stream"
}

function extractRouterError(response: any): string {
    if (!response || typeof response !== "object") {
        return ""
    }

    const errorValue = response.error
    if (typeof errorValue === "string" && errorValue.trim()) {
        return errorValue.trim()
    }

    if (errorValue && typeof errorValue === "object") {
        const msg = (errorValue as any).message
        if (typeof msg === "string" && msg.trim()) {
            return msg.trim()
        }
    }

    return ""
}

function extractLayoutText(response: any): string {
    if (!response || typeof response !== "object") {
        return ""
    }

    const layoutDetails = (response as any).layout_details
    if (Array.isArray(layoutDetails)) {
        const parts: string[] = []
        for (const page of layoutDetails) {
            if (!Array.isArray(page)) {
                continue
            }
            for (const block of page) {
                const text = block?.content
                if (typeof text === "string" && text.trim()) {
                    parts.push(text.trim())
                }
            }
        }
        if (parts.length > 0) {
            return parts.join("\n\n")
        }
    }

    return ""
}

export default class ApiModel implements Model {
    settings: ObsidianOCRSettings
    apiKey: string
    statusCheckIntervalLoading = 5000;
    statusCheckIntervalReady = 15000;

    constructor(settings: ObsidianOCRSettings) {
        this.reloadSettings(settings)
    }

    reloadSettings(settings: ObsidianOCRSettings) {
        this.settings = settings
        try {
            if (safeStorage.isEncryptionAvailable()) {
                this.apiKey = safeStorage.decryptString(Buffer.from(settings.hfApiKey as ArrayBuffer))
            } else {
                this.apiKey = settings.hfApiKey as string
            }
        } catch (error) {
            new Notice(`❌ There was an error loading your API key`)
            console.error('Error loading API key:', error);
            this.apiKey = ""
        }
    }


    load() {
        console.log("obsidian_ocr: API model loaded.")
    }

    start() { }

    unload() { }

    private async requestLayoutParsing(data: Buffer, contentType: string): Promise<any> {
        const payload = {
            file: `data:${contentType};base64,${data.toString("base64")}`,
            model: HF_ROUTER_MODEL,
        }

        const response = await requestUrl({
            url: HF_LAYOUT_PARSING_URL,
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Accept": "application/json",
            },
            contentType: "application/json",
            body: JSON.stringify(payload),
        })

        if (response.json !== undefined) {
            return response.json
        }
        if (response.text) {
            return JSON.parse(response.text)
        }

        throw new Error("Empty response from Hugging Face API")
    }

    async imgfileToLatex(filepath: string): Promise<string> {
        const file = path.parse(filepath)
        const notice = new Notice(`⚙️ Generating Latex for ${file.base}...`, 0);

        const contentType = getImageContentType(filepath)
        if (!SUPPORTED_LAYOUT_PARSING_TYPES.includes(contentType)) {
            throw new Error(`Unsupported file type: ${contentType}. Supported: JPG, PNG, PDF`)
        }

        const data = fs.readFileSync(filepath);

        try {
            const response = await this.requestLayoutParsing(data, contentType)
            const routerError = extractRouterError(response)
            if (routerError) {
                throw new Error(`Hugging Face router error: ${routerError}`)
            }

            console.debug(`obsidian_ocr: ${JSON.stringify(response)}`)
            setTimeout(() => notice.hide(), 1000)

            const latex = typeof response === "string"
                ? response
                : (
                    extractLayoutText(response)
                    || response?.generated_text
                    || response?.[0]?.generated_text
                    || response?.text
                    || response?.result?.text
                    || response?.output_text
                )
            if (latex) {
                return latex
            } else {
                throw new Error(`Malformed response from ${HF_OCR_MODEL}: ${JSON.stringify(response)}`)
            }
        } catch (error) {
            setTimeout(() => notice.hide(), 1000)
            // check 503: not provisioned
            // check 429: rate limited
            // check 400/401: unauthoorized api key
            throw error
        }
    }


    async status() {
        if (this.apiKey === "") {
            return { status: Status.Misconfigured, msg: "Api key required" }
        }

        try {
            await requestUrl({
                url: "https://huggingface.co/api/whoami-v2",
                headers: { Authorization: `Bearer ${this.apiKey}` },
                method: "GET",
            })

            return { status: Status.Ready, msg: "API key is working" }
        } catch (response) {
            if (response.status === 400 || response.status === 401) {
                return { status: Status.Misconfigured, msg: "Unauthorized: check your API key in the settings" }
            } else {
                console.error(response)
                return { status: Status.Unreachable, msg: `Got ${response.status}: ${response}` }
            }
        }
    }
}
