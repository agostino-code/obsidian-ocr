import ObsidianOCR from "main";
import { Status } from "./models/model";


export class StatusBar {
    span: HTMLSpanElement;
    plugin: ObsidianOCR;
    private started: boolean;
    private should_stop: boolean;

    constructor(plugin: ObsidianOCR) {
        this.plugin = plugin;
        this.span = plugin.addStatusBarItem();
        this.span.createEl("span", { text: "Obsidian OCR ❌" });
        this.updateStatusBar();
        if (!plugin.settings.showStatusBar) {
            this.hide();
        }
        this.should_stop = false;
        this.startStatusBar();
    }

    // Update the status bar based on current OCR backend availability.
    async updateStatusBar(): Promise<{ status: Status; msg: string; lastChecked?: number }> {
        const status = await this.plugin.model.status();

        switch (status.status) {
            case Status.Ready:
                this.span.setText("Obsidian OCR ✅");
                break;

            case Status.Downloading:
                this.span.setText("Obsidian OCR 🌐");
                break;

            case Status.Loading:
                this.span.setText("Obsidian OCR ⚙️");
                break;

            case Status.Misconfigured:
                this.span.setText("Obsidian OCR 🔧");
                break;

            case Status.Unreachable:
                this.span.setText("Obsidian OCR ❌");
                break;
        }
        return status;
    }

    // Call `updateStatusBar` periodically based on the returned status.
    // This function halts when `this.stopped` is True.
    //
    // This function should only be called once.
    private async startStatusBar() {
        if (this.started) {
            console.error("Attempted to start status bar when already started");
            return
        }
        let prevStatus = { status: Status.Loading, msg: "" };
        let loadingSleepTime = this.plugin.model.statusCheckIntervalReady;

        this.started = true;
        while (!this.should_stop) {
            const status = await this.updateStatusBar();

            if (status.status === Status.Ready) {
                await sleep(this.plugin.model.statusCheckIntervalReady);
            } else {
                if (status.status === prevStatus.status
                    && status.msg === prevStatus.msg) {
                    // slowly increase sleep time between messages
                    loadingSleepTime = Math.min(
                        loadingSleepTime * 2,
                        this.plugin.model.statusCheckIntervalReady * 2
                    );
                } else {
                    // reset the sleep time if the status has updated
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
}
