export interface SafeStorageInterface {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

interface ElectronSafeStorage {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

interface ElectronRemote {
    safeStorage?: ElectronSafeStorage;
}

interface ElectronModule {
    safeStorage?: ElectronSafeStorage;
    remote?: ElectronRemote;
}

interface WindowWithElectron {
    electron?: ElectronModule;
}

let safeStorage: SafeStorageInterface;

try {
    const win = (typeof window !== "undefined" ? window : undefined) as WindowWithElectron | undefined;
    const electronSafeStorage = win?.electron?.safeStorage || win?.electron?.remote?.safeStorage;
    if (electronSafeStorage && typeof electronSafeStorage.isEncryptionAvailable === "function") {
        safeStorage = electronSafeStorage;
    } else {
        safeStorage = {
            isEncryptionAvailable: () => false,
            encryptString: (val: string): Buffer => Buffer.from(val, "utf-8"),
            decryptString: (buf: Buffer): string => buf.toString("utf-8")
        };
    }
} catch {
    safeStorage = {
        isEncryptionAvailable: () => false,
        encryptString: (val: string): Buffer => Buffer.from(val, "utf-8"),
        decryptString: (buf: Buffer): string => buf.toString("utf-8")
    };
}

export default safeStorage;
