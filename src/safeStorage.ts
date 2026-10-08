let safeStorage: any;

try {
    const Electron = require('electron');
    safeStorage = Electron?.remote?.safeStorage || Electron?.safeStorage || (typeof window !== "undefined" && (window as any).electron?.remote?.safeStorage);
} catch {
    safeStorage = undefined;
}

if (!safeStorage) {
    safeStorage = {
        isEncryptionAvailable: () => false,
        encryptString: (val: string) => Buffer.from(val, "utf-8"),
        decryptString: (buf: Buffer) => buf.toString("utf-8")
    };
}

export default safeStorage;
