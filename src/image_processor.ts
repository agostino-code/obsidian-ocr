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

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Could not initialize 2D canvas context for image optimization");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    // Prefer JPEG for photos/scans to keep base64 payloads compact, or PNG if alpha transparency is present.
    const targetMime = inputMimeType === "image/png" ? "image/png" : "image/jpeg";
    const quality = targetMime === "image/jpeg" ? 0.92 : undefined;
    const outDataUrl = canvas.toDataURL(targetMime, quality);
    const [, base64] = outDataUrl.split(",", 2);

    if (!base64) {
        throw new Error("Failed to export optimized image canvas");
    }

    return {
        base64,
        mimeType: targetMime,
        width: targetWidth,
        height: targetHeight,
        resized,
    };
}
