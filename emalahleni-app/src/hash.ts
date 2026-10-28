// Shared by the Worker and browser; hashing must respect a typed array's view.
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
}
