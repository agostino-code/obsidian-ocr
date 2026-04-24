import { Status } from "models/model";
import ObsidianOCR from "main";
import { LocalModel } from "models/local_model";
import ApiModel from "models/online_model";
import { PluginSettingTab, App, Setting, Notice, TextComponent } from "obsidian";
import safeStorage from "safeStorage";
import { picker } from "utils";
import { normalize } from "path";

const obfuscateApiKey = (apiKey = ''): string =>
    apiKey.length > 0 ? apiKey.replace(/^(.{3})(.*)(.{4})$/, '$1****$3') : ''

export default class ObsidianOCRSettingsTab extends PluginSettingTab {
    plugin: ObsidianOCR;

    constructor(app: App, plugin: ObsidianOCR) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        const getLocalBackendLabel = () => this.plugin.settings.localBackend === "llama.cpp" ? "llama.cpp" : "Ollama";
        let saveDebounceId: number | null = null;
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
    ///// GENERAL SETTINGS /////

        new Setting(containerEl)
            .setName("Show status bar")
            .setDesc("✅ online / ⚙️ loading / 🌐 downloading / 🔧 needs configuration / ❌ unreachable")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showStatusBar)
                .onChange(async (value) => {
                    if (value) {
                        this.plugin.statusBar.show()
                    } else {
                        this.plugin.statusBar.hide()
                    }
                    this.plugin.settings.showStatusBar = value
                    await this.plugin.saveSettings()
                }));

        new Setting(containerEl)
            .setName("Use local model")
            .setDesc("Use a local model backend (Ollama or llama.cpp). See the project's README for installation instructions.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useLocalModel)
                .onChange(async value => {
                    if (this.plugin.model) {
                        this.plugin.model.unload()
                    }

                    if (value) {
                        this.plugin.model = new LocalModel(this.plugin.settings)
                        configuration_text.setText(getLocalConfText())

                        ApiSettings.forEach(e => e.hide())
                        LocalSettings.forEach(e => e.show())
                    } else {
                        this.plugin.model = new ApiModel(this.plugin.settings)
                        configuration_text.setText(API_CONF_TEXT)

                        ApiSettings.forEach(e => e.show())
                        LocalSettings.forEach(e => e.hide())
                    }
                    this.plugin.model.load()

                    this.plugin.settings.useLocalModel = value
                    await this.plugin.saveSettings()
                }))


        const checkStatus = () => {
            this.plugin.model.status().then((status) => {
                switch (status.status) {
                    case Status.Ready:
                        new Notice("✅ The server is reachable!")
                        break;

                    case Status.Downloading:
                        new Notice(`🌐 ${status.msg}`)
                        break;

                    case Status.Loading:
                        new Notice(`⚙️ ${status.msg}`)
                        break;

                    case Status.Misconfigured:
                        new Notice(`🔧 ${status.msg}`)
                        break;

                    case Status.Unreachable:
                    default:
                        new Notice(`❌ ${status.msg}`)
                        break;
                }
            })
        }

        new Setting(containerEl)
            .setName("Debug logging")
            .setDesc("To enable verbose logging, open the developer console (Ctrl+Shift+I) and set the log level to include 'Verbose' messages.");


        const API_CONF_TEXT = "HuggingFace API Configuration"
        const getLocalConfText = () => `Local ${getLocalBackendLabel()} Model Configuration`
        const configuration_text = containerEl.createEl("h5", { text: API_CONF_TEXT })
        if (this.plugin.settings.useLocalModel) {
            configuration_text.setText(getLocalConfText())
        }

        ///// API MODEL SETTINGS /////

        const KeyDisplay = new Setting(containerEl)
            .setName('Current API Key')
            .addText(text => text
                .setPlaceholder(this.plugin.settings.obfuscatedKey).setDisabled(true))

        const apiKeyDesc = new DocumentFragment()
        apiKeyDesc.textContent = "Hugging face API key. See the "
        apiKeyDesc.createEl("a", { text: "hugging face docs", href: "https://huggingface.co/docs/api-inference/quicktour#get-your-api-token" })
        apiKeyDesc.createSpan({ text: " on how to generate it." })
        const apiKeyInput = new Setting(containerEl)
            .setName('Set API Key')
            .setDesc(apiKeyDesc)
            .addText(text => text.inputEl.setAttr("type", "password"))
        apiKeyInput.addButton(btn =>
            btn.setButtonText("Submit")
                .setCta()
                .onClick(async evt => {
                    const value = (apiKeyInput.components[0] as TextComponent).getValue()
                    let key
                    if (safeStorage.isEncryptionAvailable()) {
                        key = safeStorage.encryptString(value)
                    } else {
                        key = value
                    }

                    new Notice("🔧 Api key saved")
                    this.plugin.settings.obfuscatedKey = obfuscateApiKey(value)
                    this.plugin.settings.hfApiKey = key;
                    (KeyDisplay.components[0] as TextComponent).setPlaceholder(this.plugin.settings.obfuscatedKey)
                    await this.plugin.saveSettings()
                }))


        const ApiSettings = [apiKeyInput.settingEl, KeyDisplay.settingEl]


        ///// LOCAL MODEL SETTINGS /////

        const localBackend = new Setting(containerEl)
            .setName('Local backend')
            .setDesc("Choose which local backend to use for OCR.")
            .addDropdown(dropdown => dropdown
                .addOption("ollama", "Ollama")
                .addOption("llama.cpp", "llama.cpp")
                .setValue(this.plugin.settings.localBackend)
                .onChange(async (value: string) => {
                    this.plugin.settings.localBackend = value === "llama.cpp" ? "llama.cpp" : "ollama";
                    configuration_text.setText(getLocalConfText());
                    refreshLocalBackendControls();
                    await this.plugin.saveSettings();
                }))

        const ollamaPath = new Setting(containerEl)
            .setName('Ollama command/path')
            .setDesc("Command or full path used to run Ollama. Usually `ollama` if it is available in PATH.")
            .addExtraButton(cb => cb
                .setIcon("folder")
                .setTooltip("Browse")
                .onClick(async () => {
                    const file = await picker("Open Ollama executable", ["openFile"]) as string;
                    (ollamaPath.components[1] as TextComponent).setValue(file)
                    this.plugin.settings.ollamaPath = normalize(file);
                    saveSettingsDebounced();
                }))
            .addText(text => text
                .setPlaceholder('ollama')
                .setValue(this.plugin.settings.ollamaPath)
                .onChange((value) => {
                    this.plugin.settings.ollamaPath = normalize(value);
                    saveSettingsDebounced();
                }))

        const ollamaHost = new Setting(containerEl)
            .setName('Ollama host')
            .setDesc('Base URL for Ollama, without port. Usually http://127.0.0.1')
            .addText(text => text
                .setValue(this.plugin.settings.ollamaHost)
                .onChange((value) => {
                    this.plugin.settings.ollamaHost = value.trim();
                    saveSettingsDebounced();
                }))

        const ollamaPort = new Setting(containerEl)
            .setName('Ollama port')
            .setDesc('Port where the Ollama API is exposed.')
            .addText(text => text
                .setValue(this.plugin.settings.ollamaPort)
                .onChange((value) => {
                    this.plugin.settings.ollamaPort = value.trim();
                    saveSettingsDebounced();
                }))

        const ollamaModel = new Setting(containerEl)
            .setName('Ollama model')
            .setDesc('Model name installed in Ollama (example: glm-ocr).')
            .addText(text => text
                .setValue(this.plugin.settings.ollamaModel)
                .onChange((value) => {
                    this.plugin.settings.ollamaModel = value.trim();
                    saveSettingsDebounced();
                }))

        const llamaCppPath = new Setting(containerEl)
            .setName('llama.cpp command/path')
            .setDesc("Command or full path used to run llama-server. Usually `llama-server` if it is available in PATH.")
            .addExtraButton(cb => cb
                .setIcon("folder")
                .setTooltip("Browse")
                .onClick(async () => {
                    const file = await picker("Open llama.cpp executable", ["openFile"]) as string;
                    (llamaCppPath.components[1] as TextComponent).setValue(file)
                    this.plugin.settings.llamaCppPath = normalize(file);
                    saveSettingsDebounced();
                }))
            .addText(text => text
                .setPlaceholder('llama-server')
                .setValue(this.plugin.settings.llamaCppPath)
                .onChange((value) => {
                    this.plugin.settings.llamaCppPath = normalize(value);
                    saveSettingsDebounced();
                }))

        const llamaCppHost = new Setting(containerEl)
            .setName('llama.cpp host')
            .setDesc('Base URL for llama.cpp, without port. Usually http://127.0.0.1')
            .addText(text => text
                .setValue(this.plugin.settings.llamaCppHost)
                .onChange((value) => {
                    this.plugin.settings.llamaCppHost = value.trim();
                    saveSettingsDebounced();
                }))

        const llamaCppPort = new Setting(containerEl)
            .setName('llama.cpp port')
            .setDesc('Port where the llama.cpp server API is exposed.')
            .addText(text => text
                .setValue(this.plugin.settings.llamaCppPort)
                .onChange((value) => {
                    this.plugin.settings.llamaCppPort = value.trim();
                    saveSettingsDebounced();
                }))

        const llamaCppArgs = new Setting(containerEl)
            .setName('llama.cpp startup args')
            .setDesc('Arguments passed to llama-server on startup (example: -hf ggml-org/GLM-OCR-GGUF --sleep-idle-seconds 300).')
            .addText(text => text
                .setPlaceholder('-hf ggml-org/GLM-OCR-GGUF --sleep-idle-seconds 300')
                .setValue(this.plugin.settings.llamaCppArgs)
                .onChange((value) => {
                    this.plugin.settings.llamaCppArgs = value.trim();
                    saveSettingsDebounced();
                }))

        const serverStatus = new Setting(containerEl)
            .setName('Local backend control')
            .setDesc("Use these controls to check status or start/stop the selected local backend process from Obsidian.")
            .addButton(button => button
                .setButtonText("Check status")
                .setCta()
                .onClick(evt => {
                    checkStatus()
                })
            )
            .addButton(button => button
                .setButtonText("(Re)start backend")
                .onClick(async (evt) => {
                    new Notice(`⚙️ Starting ${getLocalBackendLabel()}...`, 5000)
                    if (this.plugin.model) {
                        this.plugin.model.unload()
                        this.plugin.model.load()
                        this.plugin.model.start()
                    }
                }))
            .addButton(button => button
                .setButtonText("Stop server")
                .onClick(async (evt) => {
                    if (this.plugin.model) {
                        this.plugin.model.unload()
                        new Notice(`⚙️ ${getLocalBackendLabel()} process stopped`, 2000);
                    } else {
                        new Notice("❌ No local process found to stop", 5000);
                    }
                }))

        const OllamaSettings: HTMLElement[] = [
            ollamaPath.settingEl,
            ollamaHost.settingEl,
            ollamaPort.settingEl,
            ollamaModel.settingEl,
        ]

        const LlamaCppSettings: HTMLElement[] = [
            llamaCppPath.settingEl,
            llamaCppHost.settingEl,
            llamaCppPort.settingEl,
            llamaCppArgs.settingEl,
        ]

        const LocalSettings: HTMLElement[] = [
            localBackend.settingEl,
            ...OllamaSettings,
            ...LlamaCppSettings,
            serverStatus.settingEl,
        ]

        const refreshLocalBackendControls = () => {
            const useLlamaCpp = this.plugin.settings.localBackend === "llama.cpp"
            if (useLlamaCpp) {
                OllamaSettings.forEach(e => e.hide())
                LlamaCppSettings.forEach(e => e.show())
            } else {
                LlamaCppSettings.forEach(e => e.hide())
                OllamaSettings.forEach(e => e.show())
            }
        }

        refreshLocalBackendControls()

        if (this.plugin.settings.useLocalModel) {
            ApiSettings.forEach(e => e.hide())
        } else {
            LocalSettings.forEach(e => e.hide())
        }

    }
}
