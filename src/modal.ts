import clipboard from "clipboardy";
import ObsidianOCR from "main";
import { Modal, App, Setting, TFile, Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { picker, normalizeMathForObsidian } from "utils";

function getPreviewDataUrl(filepath: string): string | null {
    if (!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) {
        return null
    }

    const ext = path.extname(filepath).toLowerCase()
    let contentType: string | null = null

    if (ext === ".jpg" || ext === ".jpeg") {
        contentType = "image/jpeg"
    } else if (ext === ".png") {
        contentType = "image/png"
    } else if (ext === ".webp") {
        contentType = "image/webp"
    } else if (ext === ".gif") {
        contentType = "image/gif"
    } else if (ext === ".bmp" || ext === ".dib") {
        contentType = "image/bmp"
    }

    if (!contentType) {
        return null
    }

    const fileData = fs.readFileSync(filepath)
    return `data:${contentType};base64,${fileData.toString("base64")}`
}

export class ObsidianOCRModal extends Modal {
    plugin: ObsidianOCR
    imagePath: string

    constructor(app: App, plugin: ObsidianOCR) {
        super(app);
        this.plugin = plugin
    }

    onOpen() {
        this.containerEl.addClass('obsidian-ocr-modal')
        const { contentEl, titleEl } = this;
        titleEl.setText("Obsidian OCR");

        const imageContainer = contentEl.createDiv({
            cls: 'image-container',
        })
        const img = imageContainer.createEl("img")
        const selectedFileName = contentEl.createEl("p", {
            cls: "selected-file-name",
            text: "No file selected",
        })

        new Setting(contentEl)
            .setName("Open file")
            .addExtraButton(cb => cb
                .setIcon("folder")
                .setTooltip("Browse")
                .onClick(async () => {
                    const file = await picker("Open file", ["openFile"]) as string | undefined;
                    if (!file) {
                        return;
                    }

                    const normalizedFile = file.trim()
                    if (!normalizedFile || !fs.existsSync(normalizedFile) || !fs.statSync(normalizedFile).isFile()) {
                        new Notice("⚠️ Please select a valid file (not a folder)")
                        return
                    }

                    this.imagePath = normalizedFile
                    selectedFileName.setText(`Selected file: ${path.basename(normalizedFile)}`)
                    const ext = path.extname(normalizedFile).toLowerCase()
                    const tfile = this.app.vault.getAbstractFileByPath(path.relative(this.plugin.vaultPath, normalizedFile));
                    if (tfile instanceof TFile && ext !== ".pdf") {
                        img.setAttr("src", this.app.vault.getResourcePath(tfile))
                    } else {
                        const preview = getPreviewDataUrl(normalizedFile)
                        if (preview) {
                            img.setAttr("src", preview)
                        } else {
                            img.removeAttribute("src")
                        }
                    }
                }))
            .addButton(button => button
                .setButtonText("Convert to Latex")
                .setCta()
            .onClick(() => {
                const { imagePath, plugin } = this;
                if (imagePath) {
                    this.close()
                    plugin.model.imgfileToLatex(imagePath).then(async (latex) => {
                            const normalizedLatex = normalizeMathForObsidian(latex)
                            try {
                                await clipboard.write(normalizedLatex)
                            } catch (err) {
                                console.error(err);
                                new Notice(`⚠️ Couldn't copy to clipboard because document isn't focused`)
                            }
                            new Notice(`🪄 Latex copied to clipboard`)
                        }).catch(err => {
                            new Notice(`⚠️ ${err}`)
                        })
                    } else {
                        new Notice("⚠️ Select a file first (image or PDF)")
                    }
                }))
    }

    onClose() {
        const { contentEl } = this;
        this.imagePath = ""
        contentEl.empty();
    }
}