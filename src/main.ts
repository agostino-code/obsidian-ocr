/* TODO:
- add check to see if GPU is being used
- add command to start server
- allow pasting images in modal
*/

import { Notice, Plugin, TFile, FileSystemAdapter, Editor } from 'obsidian';
import clipboard from 'clipboardy';
import * as path from 'path';
import * as fs from 'fs';
import { LocalModel } from "models/local_model"
import Model, { Status } from 'models/model';
import { StatusBar } from "status_bar";
import { ObsidianOCRModal } from 'modal';
import ApiModel from 'models/online_model';
import ObsidianOCRSettingsTab from 'settings';
import { normalizeMathForObsidian } from 'utils';

export interface ObsidianOCRSettings {
	/** Legacy setting retained for backwards compatibility */
	pythonPath: string;

	/** Legacy setting retained for backwards compatibility */
	cacheDirPath: string;

	/** Path/command used to run ollama */
	ollamaPath: string;

	/** Local OCR backend implementation */
	localBackend: 'ollama' | 'llama.cpp';

	/** Host where llama.cpp API is exposed */
	llamaCppHost: string;

	/** Port where llama.cpp API is exposed */
	llamaCppPort: string;

	/** Path/command used to run llama.cpp server */
	llamaCppPath: string;

	/** Extra startup args passed to llama.cpp server */
	llamaCppArgs: string;

	/** Host where Ollama API is exposed */
	ollamaHost: string;

	/** Port where Ollama API is exposed */
	ollamaPort: string;

	/** Ollama model name used for OCR */
	ollamaModel: string;

	/** Legacy setting retained for backwards compatibility */
	port: string;

	/** Toggle status bar */
	showStatusBar: boolean;

	/** Use local model or HF API */
	useLocalModel: boolean;

	/** Hugging face API key */
	hfApiKey: string | ArrayBuffer;

	/** Obfuscated key shown in settings */
	obfuscatedKey: string;
}

const DEFAULT_SETTINGS: ObsidianOCRSettings = {
	pythonPath: 'python3',
	cacheDirPath: '',
	ollamaPath: 'ollama',
	localBackend: 'ollama',
	llamaCppHost: 'http://127.0.0.1',
	llamaCppPort: '8080',
	llamaCppPath: 'llama-server',
	llamaCppArgs: '-hf ggml-org/GLM-OCR-GGUF --sleep-idle-seconds 300',
	ollamaHost: 'http://127.0.0.1',
	ollamaPort: '11434',
	ollamaModel: 'glm-ocr',
	port: '50051',
	showStatusBar: true,
	useLocalModel: false,
	hfApiKey: "",
	obfuscatedKey: "",
}

// https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html
const IMG_EXTS = ["png", "jpg", "jpeg", "bmp", "dib", "eps", "gif", "ppm", "pbm", "pgm", "pnm", "webp"]
const PDF_EXT = "pdf"
const SUPPORTED_EXTS = [...IMG_EXTS, PDF_EXT]

export default class ObsidianOCR extends Plugin {
	settings: ObsidianOCRSettings;
	vaultPath: string;
	pluginPath: string;
	statusBar: StatusBar;
	model: Model;

	async onload() {
		// Load settings & initialize path values
		await this.loadSettings();
		this.addSettingTab(new ObsidianOCRSettingsTab(this.app, this));

		if (this.app.vault.adapter instanceof FileSystemAdapter) {
			this.vaultPath = this.app.vault.adapter.getBasePath()
		}
		if (this.manifest.dir) {
			this.pluginPath = this.manifest.dir
		}
		if (this.settings.cacheDirPath === "") {
			this.settings.cacheDirPath = path.resolve(this.pluginPath, "model_cache")
			await this.saveSettings()
		}

		if (this.settings.useLocalModel) {
			this.model = new LocalModel(this.settings)
		} else {
			this.model = new ApiModel(this.settings)
		}
		this.model.load()


		// Folder where temporary pasted files are stored
		try {
			await fs.promises.mkdir(path.join(this.vaultPath, this.pluginPath, "/.clipboard_images/"));
		} catch (err) {
			if (!err.message.includes("EEXIST")) {
				console.error(err)
			}
		}

		// Right-click "Generate Latex" menu on supported files
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && SUPPORTED_EXTS.includes(file.extension)) {
					menu.addItem((item) => {
						item
							.setTitle("Generate Formula")
							.setIcon("sigma")
							.setSection("info")
							.onClick(async () => {
								this.model.imgfileToLatex(path.join(this.vaultPath, file.path)).then(async (latex) => {
									const normalizedLatex = normalizeMathForObsidian(latex)
									try {
										await clipboard.write(normalizedLatex)
									} catch (err) {
										console.error(err);
										new Notice(`⚠️ Couldn't copy to clipboard because document isn't focused`)
									}
									new Notice(`🪄 Latex copied to clipboard`)
								}
								).catch((err) => {
									new Notice(`⚠️ ${err}`)
								})
							});
					});
				}
			})
		)

		// Modal
		this.addRibbonIcon('sigma', 'Obsidian OCR', (evt) => {
			new ObsidianOCRModal(this.app, this).open()
		})

		// Command to read image from clipboard
		this.addCommand({
			id: 'paste-formula-from-clipboard-image',
			name: 'Paste formula from clipboard image',
			editorCallback: (editor, ctx) => {
				this.clipboardToText(editor).catch((err) => {
					new Notice(`❌ ${err.message}`)
					console.error(err.name, err.message)
				})
			}
		})

		// Add (Re)start server command to command palette
		this.addCommand({
			id: 'restart-local-ocr-service',
			name: '(Re)start local OCR service',
			callback: async () => {
				new Notice("⚙️ Starting local OCR service...", 5000);
				if (this.model) {
					this.model.unload();
					this.model.load();
					this.model.start();
				}
			}
		});

		// Add Stop server command to command palette
		this.addCommand({
			id: 'stop-local-ocr-service',
			name: 'Stop local OCR service',
			callback: async () => {
				if (this.model) {
					this.model.unload();
				}
			}
		});

		// Status bar
		this.statusBar = new StatusBar(this)
	}

	onunload() {
		this.model?.unload()
		this.statusBar.stop()
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		delete (this.settings as Partial<ObsidianOCRSettings> & Record<string, unknown>).startServerOnLoad;
	}

	async saveSettings() {
		if (this.model) {
			this.model.reloadSettings(this.settings)
		}
		await this.saveData(this.settings);
	}

	// Get a clipboard file, save it to disk temporarily,
	// call the OCR backend.
	async clipboardToText(editor: Editor) {
		// Get clipboard file
		const file = await navigator.clipboard.read();
		if (file.length === 0) {
			throw new Error("Couldn't find image in clipboard")
		}

		let filetype = null;
		for (const ext of IMG_EXTS) {
			if (file[0].types.includes(`image/${ext}`)) {
				console.debug(`obsidian_ocr: found image in clipboard with mimetype image/${ext}`)
				filetype = ext;
				break
			}
		}

		if (filetype === null) {
			throw new Error("Couldn't find image in clipboard")
		}

		// If local backend is unreachable on the first paste, try starting it and continue.
		const status = await this.model.status()
		if (status.status === Status.Unreachable) {
			console.warn(`obsidian_ocr: backend unreachable, trying auto-start before OCR: ${status.msg}`)
			this.model.start()
		} else if (status.status === Status.Misconfigured) {
			throw new Error(status.msg)
		}

		// Write generating message
		const from = editor.getCursor("from")
		console.debug(`obsidian_ocr: received paste command at line ${from.line}`)
		const waitMessage = `\\LaTeX \\text{ is being generated... } \\vphantom{${from.line}}`
		const fullMessage = `$$${waitMessage}$$`

		editor.replaceSelection(fullMessage)

		// Save image to file
		const blob = await file[0].getType(`image/${filetype}`);
		const buffer = Buffer.from(await blob.arrayBuffer());
		const imgpath = path.join(this.vaultPath, this.pluginPath, `/.clipboard_images/pasted_image.${filetype}`);
		fs.writeFileSync(imgpath, buffer)

		let latex: string;
		try {
			// Get latex
			latex = await this.model.imgfileToLatex(imgpath)
			latex = normalizeMathForObsidian(latex)
		} catch (err) {
			// If err, return empty string so that we erase `fullMessage`
			latex = ""
			new Notice(`⚠️ ${err} `, 5000)
			console.error(err)
		}

		// Find generating message again.
		// Starts search from original line, then downwards to the end of the document,
		// Then upwards to the start of the document.
		const firstLine = 0;
		const lastLine = editor.lineCount() - 1;
		let currLine = from.line;

		while (currLine <= lastLine) {
			const text = editor.getLine(currLine);
			const from = text.indexOf(fullMessage)
			if (from !== -1) {
				editor.replaceRange(latex, { line: currLine, ch: from }, { line: currLine, ch: from + fullMessage.length })
				if (latex !== "") {
					new Notice(`🪄 Latex pasted to note`)
				}
				return
			}
			currLine += 1;
		}

		currLine = from.line - 1;
		while (currLine >= firstLine) {
			const text = editor.getLine(currLine);
			const from = text.indexOf(fullMessage)
			if (from !== -1) {
				editor.replaceRange(latex, { line: currLine, ch: from }, { line: currLine, ch: from + fullMessage.length })
				if (latex !== "") {
					new Notice(`🪄 Latex pasted to note`)
				}
				return
			}
			currLine -= 1;
		}

		// If the message isn't found, abort
		throw new Error("Couldn't find paste target")
	}
}
