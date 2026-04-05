'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function fatal(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

// Read required environment variables
const BG_PAYLOAD = process.env.BG_PAYLOAD;
const BG_SRE_KEY_ID = process.env.BG_SRE_KEY_ID;
const BG_SRE_SIGNATURE = process.env.BG_SRE_SIGNATURE;
const BG_RELEASE_ENG_KEY_ID = process.env.BG_RELEASE_ENG_KEY_ID;
const BG_RELEASE_ENG_SIGNATURE = process.env.BG_RELEASE_ENG_SIGNATURE;

if (!BG_PAYLOAD) fatal('BG_PAYLOAD is required');
if (!BG_SRE_KEY_ID) fatal('BG_SRE_KEY_ID is required');
if (!BG_SRE_SIGNATURE) fatal('BG_SRE_SIGNATURE is required');
if (!BG_RELEASE_ENG_KEY_ID) fatal('BG_RELEASE_ENG_KEY_ID is required');
if (!BG_RELEASE_ENG_SIGNATURE) fatal('BG_RELEASE_ENG_SIGNATURE is required');

// Reject same keyholder satisfying both roles
if (BG_SRE_KEY_ID === BG_RELEASE_ENG_KEY_ID) {
  fatal('same key_id used for both roles');
}

// Load authorized keys registry
const keysPath = path.join(__dirname, 'authorized-keys.json');
let registry;
try {
  registry = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
} catch (err) {
  fatal(`failed to load authorized-keys.json: ${err.message}`);
}

// Look up a key entry by key_id and required role
function lookupKey(keyId, requiredRole) {
  const entry = registry.keys.find(
    k => k.key_id === keyId && k.roles.includes(requiredRole)
  );
  if (!entry) {
    fatal(`key not found: ${keyId}`);
  }
  return entry;
}

// Verify an Ed25519 signature using crypto.verify (constant-time for Ed25519)
function verifySignature(roleLabel, publicKeyPem, payloadBuf, signatureHex) {
  let sigBuf;
  try {
    sigBuf = Buffer.from(signatureHex, 'hex');
  } catch (_) {
    fatal(`${roleLabel} signature is not valid hex`);
  }

  let valid = false;
  try {
    valid = crypto.verify(
      null, // algorithm is implicit for Ed25519 keys
      payloadBuf,
      { key: publicKeyPem, format: 'pem' },
      sigBuf
    );
  } catch (_) {
    valid = false;
  }

  if (!valid) {
    fatal(`${roleLabel} signature invalid`);
  }
}

const payloadBuf = Buffer.from(BG_PAYLOAD, 'utf8');

// Verify SRE leg
const sreEntry = lookupKey(BG_SRE_KEY_ID, 'sre');
verifySignature('SRE', sreEntry.public_key_pem, payloadBuf, BG_SRE_SIGNATURE);

// Verify Release Engineering leg
const reEntry = lookupKey(BG_RELEASE_ENG_KEY_ID, 'release-engineering');
verifySignature('release-engineering', reEntry.public_key_pem, payloadBuf, BG_RELEASE_ENG_SIGNATURE);

process.stdout.write(
  `MULTISIG OK | sre=${sreEntry.identity} release-eng=${reEntry.identity}\n`
);
process.exit(0);
