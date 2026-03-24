declare global {
    interface Window {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        electron: any;
    }
}

export async function picker(
    message: string,
    properties: string[]
) {
    const dirPath: string[] | undefined = window.electron.remote.dialog.showOpenDialogSync({
        title: message,
        properties
    });
    if (!dirPath || dirPath.length === 0) {
        return undefined;
    }
    if (properties.includes("multiSelections")) return dirPath
    else return dirPath[0];
}

export function normalizeMathForObsidian(text: string): string {
    if (!text) {
        return text;
    }

    // Inline math in Obsidian should not contain extra spaces right after/before delimiters.
    let normalized = text.replace(/\$(?!\$)([^$\n]*?)\$(?!\$)/g, (match, inner: string) => {
        const trimmed = inner.trim();
        if (!trimmed) {
            return match;
        }
        return `$${trimmed}$`;
    });

    // Also normalize display math boundaries.
    normalized = normalized.replace(/\$\$([\s\S]*?)\$\$/g, (_match, inner: string) => {
        return `$$${inner.trim()}$$`;
    });

    return normalized;
}