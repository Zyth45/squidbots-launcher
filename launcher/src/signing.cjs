'use strict';
// Release manifests are signed with the realm owner's Ed25519 key (tools/keygen.mjs).
// The launcher ships only the public key: a hijacked download host cannot forge an update.
const crypto = require('node:crypto');

function publicKey(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (text.startsWith('-----BEGIN')) return crypto.createPublicKey(text);
  const raw = Buffer.from(text, 'base64');
  if (raw.length !== 32) throw new Error('The release public key must be 32 bytes of Ed25519 in base64.');
  // SubjectPublicKeyInfo prefix for Ed25519 followed by the raw key.
  return crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
}

function verify(bytes, signature, key) {
  if (!key) return false;
  const decoded = Buffer.from(String(signature || '').trim(), 'base64');
  if (decoded.length !== 64) return false;
  return crypto.verify(null, bytes, key, decoded);
}

// Fetches `url` and `url.sig`; with a key configured the signature is mandatory.
// redirect: 'error' by default; 'follow' only for a host that serves its files through a redirect (GitHub
// releases): the signature, not the address, is what makes a file trusted.
// Just after a publication, a cache of the host can still serve the old file with the new signature (or the other
// way round): a refused pair is read once more, both files asked past the cache, and checked the same way.
async function fetchSigned(url, options) {
  try { return await fetchSignedOnce(url, options); }
  catch (error) {
    if (!error.badSignature) throw error;
    const fresh = new URL(url);
    fresh.searchParams.set('fresh', String(Date.now()));
    return fetchSignedOnce(fresh, options);
  }
}

async function fetchSignedOnce(url, { key, fetchImpl, signal, maxBytes, redirect = 'error' }) {
  const response = await fetchImpl(url, { cache: 'no-store', redirect, signal });
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'Nothing has been published yet.' : `The update server returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('The release manifest is too large.');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  let signed = false;
  if (key) {
    const sigUrl = new URL(url.pathname.split('/').pop() + '.sig', url);
    sigUrl.search = url.search;
    const sig = await fetchImpl(sigUrl, { cache: 'no-store', redirect, signal });
    if (!sig.ok || !verify(bytes, await sig.text(), key)) throw Object.assign(new Error('The release signature is invalid. The update was refused for your safety.'), { badSignature: true });
    signed = true;
  }
  return { data: JSON.parse(bytes.toString('utf8')), signed };
}

module.exports = { publicKey, verify, fetchSigned };
