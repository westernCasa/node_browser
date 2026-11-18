// Crypto for the shared sync code (core/sync-crypto.js, B50), from
// expo-crypto. Imported first in index.js, because @noble reads
// globalThis.crypto when it loads.
//   - crypto.getRandomValues: random nonces, pairing codes and device ids.
//   - AES-256-GCM for sync batches: iOS CryptoKit and Android javax.crypto,
//     the phone's own encryption, so the app stays exempt from export
//     documentation on the App Store (decided 2026-11-18).
import { getRandomValues, AESEncryptionKey, AESSealedData, aesEncryptAsync, aesDecryptAsync } from "expo-crypto";

if (!globalThis.crypto || typeof globalThis.crypto !== "object") globalThis.crypto = {};
if (typeof globalThis.crypto.getRandomValues !== "function") globalThis.crypto.getRandomValues = (array) => getRandomValues(array);

// Loaded after getRandomValues is in place (a require is not hoisted).
require("../../core/sync-crypto").setAes({
  async encrypt(key, nonce, plain) {
    const sealed = await aesEncryptAsync(plain, await AESEncryptionKey.import(key), { nonce: { bytes: nonce } });
    return (await sealed.combined()).slice(nonce.length); // ciphertext + 16-byte tag
  },
  async decrypt(key, nonce, body) {
    const combined = new Uint8Array(nonce.length + body.length);
    combined.set(nonce, 0);
    combined.set(body, nonce.length);
    const sealed = AESSealedData.fromCombined(combined, { ivLength: nonce.length, tagLength: 16 });
    return new Uint8Array(await aesDecryptAsync(sealed, await AESEncryptionKey.import(key), { output: "bytes" }));
  },
});
