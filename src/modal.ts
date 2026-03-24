import clipboard from "clipboardy";
import ObsidianOCR from "main";
import { Modal, App, Setting, TFile, Notice } from "obsidian";
import * as path from "path";
import { picker, normalizeMathForObsidian } from "utils";

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

        new Setting(contentEl)
            .setName("Open image")
            .addExtraButton(cb => cb
                .setIcon("folder")
                .setTooltip("Browse")
                .onClick(async () => {
                    const file = await picker("Open image", ["openFile"]) as string;
                    this.imagePath = file
                    const tfile = this.app.vault.getAbstractFileByPath(path.relative(this.plugin.vaultPath, file));
                    img.setAttr("src", this.app.vault.getResourcePath(tfile as TFile))
                }))
            .addButton(button => button
                .setButtonText("Convert to Latex")
                .setCta()
                .onClick(evt => {
                    if (this.imagePath) {
                        this.plugin.model.imgfileToLatex(this.imagePath).then(async (latex) => {
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
                        new Notice("⚠️ Select an image first")
                    }
                }))
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}