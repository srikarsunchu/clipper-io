/** Small, portable, deterministic string hash (FNV-1a, 32-bit) over a stable
 * JSON encoding of a value. Deliberately not a cryptographic hash and not
 * Node's `crypto` module -- this needs to run identically in the browser
 * (editor preview) and under Node (sidecar), and it only needs to be a
 * stable cache/dedup key, not collision-resistant against adversarial input.
 * Shared by render-plan.ts's planHash and the sidecar's generation-request
 * promptHash so there's exactly one hashing implementation to keep in sync. */
export function stableHash(value: unknown): string {
  const encoded = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < encoded.length; i++) {
    hash ^= encoded.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
