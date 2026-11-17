// crypto.getRandomValues for the shared sync code (core/sync-crypto.js, B50),
// from expo-crypto. Imported first in index.js, because @noble reads
// globalThis.crypto when it loads.
import { getRandomValues } from "expo-crypto";

if (!globalThis.crypto || typeof globalThis.crypto !== "object") globalThis.crypto = {};
if (typeof globalThis.crypto.getRandomValues !== "function") globalThis.crypto.getRandomValues = (array) => getRandomValues(array);
