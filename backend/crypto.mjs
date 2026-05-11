// Pure encryption + password-hashing primitives. Extracted from db.mjs's
// god-module during the #82 split; the surrounding DB glue
// (changePassword / verifyPassword, both of which read/write rows via
// dbGet+dbRun, plus the migrateEncryption* helpers that drive raw
// DB.prepare against the singleton) stays in db.mjs and consumes these
// primitives via direct import.
//
// Re-exported through db.mjs so existing call sites don't churn.

import crypto from 'node:crypto';

import { env } from './env.mjs';

// Function to generate a new IV for each encryption
export const generateIv = () => {
  return crypto.randomBytes(env.IV_LEN); // 16 bytes
};

// Ciphertext format markers:
//   "g1:<iv_hex>:<tag_hex>:<cipher_hex>"  — current GCM format with auth tag
//   "<iv_hex><cipher_hex>"                — legacy CBC format (bare hex, no separator)
// New writes always use GCM. Reads detect the format prefix and dispatch.
export const GCM_FORMAT_PREFIX = 'g1:';

export const encrypt = (data) => {
  const iv = generateIv();
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(env.AES_KEY),
    iv
  );
  let encrypted = cipher.update(data, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${GCM_FORMAT_PREFIX}${iv.toString('hex')}:${tag}:${encrypted}`;
};

export const decrypt = (encryptedData) => {
  if (encryptedData == null) return encryptedData;

  // GCM (current format): authenticated; final() throws on tag mismatch
  if (
    typeof encryptedData === 'string' &&
    encryptedData.startsWith(GCM_FORMAT_PREFIX)
  ) {
    const parts = encryptedData.slice(GCM_FORMAT_PREFIX.length).split(':');
    if (parts.length !== 3)
      throw new Error('decrypt: malformed GCM ciphertext');
    const [ivHex, tagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(env.AES_KEY),
      iv
    );
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }

  // Legacy CBC format: read-only path for migrating pre-2.2.0 data.
  // Lacks an auth tag — a tampered ciphertext returns garbage instead of
  // throwing. Do NOT use this path for writes; migrateEncryptionAlgorithm()
  // in db.mjs promotes any row that lands here to the GCM format.
  const ivLength = env.IV_LEN * 2;
  const iv = Buffer.from(encryptedData.slice(0, ivLength), 'hex');
  const ciphertext = encryptedData.slice(ivLength);
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(env.AES_KEY),
    iv
  );
  let decrypted = decipher.update(ciphertext, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
};

export const hashPassword = async (password = '', salt = '') => {
  return new Promise((resolve, reject) => {
    salt = salt ? salt : generateIv().toString('hex'); // Generate a random 16-byte salt
    crypto.scrypt(password, salt, env.HASH_LEN, (error, derivedKey) => {
      // env.HASH_LEN is the key length, 64 by default
      if (error) return reject(error);
      resolve({ salt, hash: derivedKey.toString('hex') }); // Store salt and hash as hex strings
    });
  });
};
