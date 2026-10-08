export interface ProcessedImage {
    base64: string;
    mimeType: string;
    width: number;
    height: number;
    resized: boolean;
}

/**
 * Preprocess an image buffer: downscales large images proportionally to fit within maxDimension,
 * reducing memory consumption and multimodal visual token usage.
 */
export async function preprocessImageBuffer(
    buffer: Buffer,
    inputMimeType: string = "image/png",
    maxDimension: number = 1536
): Promise<ProcessedImage> {
    const dataUrl = `data:${inputMimeType};base64,${buffer.toString("base64")}`;

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not decode image for OCR"));
        img.src = dataUrl;
    });

    const originalWidth = image.naturalWidth || image.width;
    const originalHeight = image.naturalHeight || image.height;

    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    let resized = false;

    if (maxDimension > 0 && (originalWidth > maxDimension || originalHeight > maxDimension)) {
        const scale = maxDimension / Math.max(originalWidth, originalHeight);
        targetWidth = Math.max(1, Math.round(originalWidth * scale));
        targetHeight = Math.max(1, Math.round(originalHeight * scale));
        resized = true;
    }

    // If no resizing is needed and input is already a lightweight format (jpeg/png/webp),
    // we can return the original buffer directly to avoid re-encoding.
    if (!resized && (inputMimeType === "image/jpeg" || inputMimeType === "image/png" || inputMimeType === "image/webp")) {
        return {
            base64: buffer.toString("base64"),
            mimeType: inputMimeType,
            width: originalWidth,
            height: originalHeight,
            resized: false,
        };
    }

    const canvas = createEl("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Could not initialize 2D canvas context for image optimization");
    }

    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    // Export as JPEG with 0.85 quality for photographic/dense images or WebP/PNG
    const exportMime = inputMimeType === "image/png" ? "image/png" : "image/jpeg";
    const quality = exportMime === "image/jpeg" ? 0.85 : undefined;
    const resizedDataUrl = canvas.toDataURL(exportMime, quality);
    const prefix = `data:${exportMime};base64,`;
    const base64Data = resizedDataUrl.startsWith(prefix)
        ? resizedDataUrl.slice(prefix.length)
        : resizedDataUrl.replace(/^data:[^;]+;base64,/, "");

    return {
        base64: base64Data,
        mimeType: exportMime,
        width: targetWidth,
        height: targetHeight,
        resized: true,
    };
}
