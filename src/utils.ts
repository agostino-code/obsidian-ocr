interface ElectronDialog {
    showOpenDialogSync(options: {
        title: string;
        properties: string[];
    }): string[] | undefined;
}

interface ElectronRemote {
    dialog?: ElectronDialog;
}

interface ElectronNamespace {
    remote?: ElectronRemote;
}

interface WindowWithElectronDialog {
    electron?: ElectronNamespace;
}

export async function picker(
    message: string,
    properties: string[]
): Promise<string | string[] | undefined> {
    const win = (typeof window !== "undefined" ? window : undefined) as WindowWithElectronDialog | undefined;
    const dialog = win?.electron?.remote?.dialog;
    if (!dialog) {
        return undefined;
    }

    const dirPath = dialog.showOpenDialogSync({
        title: message,
        properties
    });

    if (!dirPath || dirPath.length === 0) {
        return undefined;
    }
    if (properties.includes("multiSelections")) return dirPath;
    else return dirPath[0];
}

export async function copyToClipboard(text: string): Promise<void> {
    if (navigator?.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // fallback below
        }
    }
    try {
        const electron = (window as unknown as { electron?: { clipboard?: { writeText(s: string): void } } }).electron;
        if (electron?.clipboard?.writeText) {
            electron.clipboard.writeText(text);
            return;
        }
    } catch {
        // clipboard write failed
    }
}

export function normalizeMathForObsidian(text: string, forceWrap: boolean = true): string {
    if (!text) {
        return text;
    }

    let trimmed = text.trim();

    // Remove markdown code fences if the model output wrapped it in ```latex or ```
    const fenceMatch = trimmed.match(/^```(?:latex|tex)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) {
        trimmed = fenceMatch[1].trim();
    }

    // Check if it is already enclosed by LaTeX delimiters
    const isEnclosedByDisplayDollar = trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length >= 4;
    const isEnclosedByInlineDollar = !isEnclosedByDisplayDollar && trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length >= 2;
    const isEnclosedBySlashBracket = trimmed.startsWith("\\[") && trimmed.endsWith("\\]") && trimmed.length >= 4;
    const isEnclosedBySlashParen = trimmed.startsWith("\\(") && trimmed.endsWith("\\)") && trimmed.length >= 4;

    if (isEnclosedBySlashBracket) {
        const inner = trimmed.slice(2, -2).trim();
        return inner.includes("\n") ? `$$\n${inner}\n$$` : `$$${inner}$$`;
    }

    if (isEnclosedBySlashParen) {
        const inner = trimmed.slice(2, -2).trim();
        return `$${inner}$`;
    }

    if (isEnclosedByDisplayDollar) {
        const inner = trimmed.slice(2, -2).trim();
        return inner.includes("\n") ? `$$\n${inner}\n$$` : `$$${inner}$$`;
    }

    if (isEnclosedByInlineDollar) {
        const inner = trimmed.slice(1, -1).trim();
        return `$${inner}$`;
    }

    // If it already contains internal dollar delimiters (e.g. mixed markdown with inline/block math),
    // sanitize spacing around delimiters for Obsidian
    if (/\$[^$]+\$/.test(trimmed)) {
        return trimmed
            .replace(/\$(?!\$)([^$\n]*?)\$(?!\$)/g, (match, inner: string) => {
                const innerTrimmed = inner.trim();
                return innerTrimmed ? `$${innerTrimmed}$` : match;
            })
            .replace(/\$\$([\s\S]*?)\$\$/g, (_match, inner: string) => {
                const innerTrimmed = inner.trim();
                return innerTrimmed.includes("\n") ? `$$\n${innerTrimmed}\n$$` : `$$${innerTrimmed}$$`;
            });
    }

    // If forceWrap is disabled, leave plain text unwrapped
    if (!forceWrap) {
        return trimmed;
    }

    // Otherwise, wrap the raw formula: multi-line in display $$...$$, single-line in $$...$$
    if (trimmed.includes("\n")) {
        return `$$\n${trimmed}\n$$`;
    } else {
        return `$$${trimmed}$$`;
    }
}

/**
 * Unwraps outer Markdown code fences if the model wrapped the entire output in ```markdown or ```.
 */
export function unwrapOuterCodeBlock(text: string): string {
    if (!text) return text;
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/i);
    if (fenceMatch) {
        return fenceMatch[1].trim();
    }
    return trimmed;
}

/**
 * Decodes HTML entities commonly output by Vision/OCR models.
 */
export function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}

/**
 * Sanitizes math formulas inside a Markdown table cell.
 */
function sanitizeTableCell(content: string): string {
    let text = decodeHtmlEntities(content).trim();

    // Replace literal newlines inside table cells to prevent breaking the single-line Markdown table row
    text = text.replace(/\r?\n/g, " ");

    // Check if cell has unbalanced dollar signs, e.g. text ending in $ or starting with $ without pair
    const dollarCount = (text.match(/(?<!\\)\$/g) || []).length;
    if (dollarCount % 2 !== 0) {
        if (text.startsWith("$") && !text.endsWith("$")) {
            text = text + "$";
        } else if (!text.startsWith("$") && text.endsWith("$")) {
            const lastWordIdx = text.lastIndexOf(" ");
            if (lastWordIdx !== -1) {
                text = text.slice(0, lastWordIdx + 1) + "$" + text.slice(lastWordIdx + 1);
            } else {
                text = "$" + text;
            }
        }
    }

    // Escape table separator pipe `|` if outside or inside math, so Markdown doesn't split columns.
    text = text.replace(/(?<!\\)\|/g, "\\|");

    return text;
}

/**
 * Converts HTML tables (often generated by Vision-OCR models like GLM-OCR) into Obsidian Markdown tables.
 */
export function htmlTableToMarkdown(content: string): string {
    if (!content || !content.includes("<table")) {
        return content;
    }

    return content.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, inner) => {
        const rows: string[][] = [];
        const trMatches = inner.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
        for (const tr of trMatches) {
            const cells: string[] = [];
            const cellMatches = tr.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];
            for (const cell of cellMatches) {
                const rawCellText: string = cell.replace(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/i, "$1");
                cells.push(sanitizeTableCell(rawCellText));
            }
            if (cells.length > 0) {
                rows.push(cells);
            }
        }
        if (rows.length === 0) {
            return match;
        }
        const maxCols = Math.max(...rows.map(r => r.length));
        if (maxCols === 0) {
            return match;
        }
        const normalized = rows.map(r => {
            const copy = [...r];
            while (copy.length < maxCols) {
                copy.push("");
            }
            return "| " + copy.join(" | ") + " |";
        });
        const header = normalized[0];
        const separator = "| " + Array(maxCols).fill("---").join(" | ") + " |";
        const body = normalized.slice(1);
        return [header, separator, ...body].join("\n");
    });
}
