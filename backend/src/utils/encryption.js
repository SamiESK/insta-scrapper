import crypto from 'crypto';

// Encryption key from environment variable
// If not set, generate a random one (but this will change on restart!)
let ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY === 'change-this-to-a-random-64-character-hex-string') {
  // Generate a random key if not set or using placeholder
  ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  WARNING: ENCRYPTION_KEY not properly set in .env! Using random key (passwords will be lost on restart)');
  console.warn('⚠️  Please set ENCRYPTION_KEY in .env to a 64-character hex string (generate with: openssl rand -hex 32)');
}

// Ensure key is exactly 64 hex characters (32 bytes)
if (ENCRYPTION_KEY.length !== 64) {
  // Pad or truncate to 64 characters
  if (ENCRYPTION_KEY.length < 64) {
    ENCRYPTION_KEY = ENCRYPTION_KEY.padEnd(64, '0');
  } else {
    ENCRYPTION_KEY = ENCRYPTION_KEY.slice(0, 64);
  }
}

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Encrypt a password
 */
export function encryptPassword(password) {
  if (!password) return null;
  
  try {
    // Convert hex string to buffer (32 bytes for AES-256)
    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('Invalid key length - must be 64 hex characters (32 bytes)');
    }
    
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
    
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    throw new Error('Encryption failed: ' + error.message);
  }
}

/**
 * Decrypt a password
 */
export function decryptPassword(encryptedPassword) {
  if (!encryptedPassword) return null;
  
  try {
    const parts = encryptedPassword.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted password format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('Invalid key length - must be 64 hex characters (32 bytes)');
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Decryption failed: ' + error.message);
  }
}

