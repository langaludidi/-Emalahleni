function decode(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
function encode(value: Uint8Array) { return btoa(String.fromCharCode(...value)); }
async function keyFrom(secret: string) {
  const bytes = decode(secret);
  if (bytes.length !== 32) throw new Error('ENCRYPTION_UNCONFIGURED');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const context = (project: string, application: string) => new TextEncoder().encode(`emalahleni:v1:${project}:${application}`);
export async function encryptForm(value: unknown, secret: string, project: string, application: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(project, application) }, await keyFrom(secret), data);
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function decryptForm(value: string, secret: string, project: string, application: string) {
  const [version, iv, encrypted, extra] = value.split('.');
  if (version !== 'v1' || extra || !iv || !encrypted) throw new Error('UNSUPPORTED_CIPHERTEXT');
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: context(project, application) }, await keyFrom(secret), decode(encrypted));
  return JSON.parse(new TextDecoder().decode(data));
}
