// Node check for the vault crypto (mirrors background.js). Run: node test/vault.test.mjs
import assert from 'node:assert/strict';

const enc = new TextEncoder();
const dec = new TextDecoder();
const KDF_ITERATIONS = 600000;
const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

async function deriveKek(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
async function encryptKey(apiKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveKek(passphrase, salt, KDF_ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, enc.encode(apiKey));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: KDF_ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function decryptKey(vault, passphrase) {
  const kek = await deriveKek(passphrase, unb64(vault.salt), vault.iter || KDF_ITERATIONS);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, kek, unb64(vault.ct));
  return dec.decode(pt);
}

const KEY = 'oc-go-demo-key-0123456789abcdef';
const PASS = 'correct horse battery staple';
const t0 = Date.now();
const vault = await encryptKey(KEY, PASS);
const t1 = Date.now();

// 1. roundtrip
assert.equal(await decryptKey(vault, PASS), KEY, 'roundtrip must recover the key');
console.log('ok  roundtrip (encrypt+decrypt)');

// 2. ciphertext does not contain the plaintext key
assert.ok(!JSON.stringify(vault).includes(KEY), 'vault must not contain the plaintext');
assert.ok(vault.ct.length > 0 && !vault.ct.includes(KEY), 'ct must not contain the plaintext');
console.log('ok  no plaintext in vault');

// 3. wrong passphrase fails (GCM auth)
await assert.rejects(() => decryptKey(vault, 'wrong passphrase'), 'wrong passphrase must fail');
console.log('ok  wrong passphrase rejected');

// 4. tampered ciphertext fails
const bad = { ...vault, ct: b64(new Uint8Array(unb64(vault.ct).map((b, i) => (i === 0 ? b ^ 1 : b)))) };
await assert.rejects(() => decryptKey(bad, PASS), 'tampered ciphertext must fail');
console.log('ok  tampered ciphertext rejected');

console.log(`PBKDF2 ${KDF_ITERATIONS} iters: ${t1 - t0} ms per derivation`);
console.log('ALL PASS');
