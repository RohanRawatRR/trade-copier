// Encryption utilities compatible with Python's Fernet
// Uses the fernet library to match Python's cryptography.fernet

import { Secret, Token } from 'fernet';

/**
 * Decrypt data encrypted by Python's Fernet
 * @param encryptedData - Base64 encoded Fernet token
 * @returns Decrypted string
 */
export function decryptApiKey(encryptedData: string): string {
  let key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY not found in environment variables. Please set it in .env');
  }

  // Trim whitespace and remove quotes if present
  key = key.trim().replace(/^["']|["']$/g, '');

  // Validate key format (Fernet keys are 44 characters, base64url encoded)
  console.log('ENCRYPTION_KEY found. Length:', key.length);
  
  if (key.length !== 44) {
    throw new Error(`ENCRYPTION_KEY appears invalid. Length: ${key.length}. Expected: 44 characters (Fernet key format). Key preview: ${key.substring(0, 10)}...`);
  }

  try {
    console.log('Creating Fernet secret and token...');
    
    // Create Secret object from base64 key
    const secret = new Secret(key);
    
    // Create Token with the secret
    const token = new Token({
      secret: secret,
      ttl: 0, // No expiration check
    });
    
    console.log('Decoding encrypted data...');
    const decrypted = token.decode(encryptedData);
    console.log('✓ Decryption successful!');
    return decrypted;
  } catch (error: any) {
    console.error('Decryption error details:', {
      error: error.message,
      errorType: error.constructor.name,
      keyLength: key?.length,
      encryptedDataLength: encryptedData?.length,
      encryptedDataPreview: encryptedData?.substring(0, 20) + '...',
    });
    
    // More helpful error message
    if (error.message.includes('sigBytes')) {
      throw new Error('Encryption key format issue. Make sure ENCRYPTION_KEY is a valid Fernet key (44 base64 characters)');
    }
    
    throw new Error(`Failed to decrypt API key: ${error.message}`);
  }
}

/**
 * Encrypt data compatible with Python's Fernet
 * @param data - Plain text to encrypt
 * @returns Base64 encoded Fernet token
 */
export function encryptApiKey(data: string): string {
  let key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY not found in environment variables');
  }

  // Trim whitespace and remove quotes if present
  key = key.trim().replace(/^["']|["']$/g, '');

  try {
    // Create Secret object from base64 key
    const secret = new Secret(key);
    
    // Create Token with the secret
    const token = new Token({
      secret: secret,
    });
    
    const encrypted = token.encode(data);
    return encrypted;
  } catch (error: any) {
    console.error('Encryption error:', error.message);
    throw new Error(`Failed to encrypt API key: ${error.message}`);
  }
}

/**
 * Validate if a key is properly formatted
 * @param key - Key to validate
 * @returns boolean
 */
export function validateApiKey(key: string): boolean {
  // Basic validation - Alpaca keys start with PK (public) or SK (secret)
  return key.length > 10 && key.length < 500;
}
