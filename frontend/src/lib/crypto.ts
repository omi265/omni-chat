import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const KEY_STORAGE_PREFIX = 'p2p_chat_keys_';
const ROOM_KEY_STORAGE_PREFIX = 'p2p_room_keys_';

export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

// Generate or load a persistent keypair for a username
export const getPersistentKeyPair = (username: string): KeyPair => {
  const stored = typeof window !== 'undefined' ? localStorage.getItem(KEY_STORAGE_PREFIX + username) : null;
  
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse stored keys', e);
    }
  }

  // Fallback to random if no password provided (legacy support)
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: util.encodeBase64(keyPair.publicKey),
    secretKey: util.encodeBase64(keyPair.secretKey),
  };
};

// --- PASSWORD BASED IDENTITY ---

/**
 * Derives a stable KeyPair from a username and password.
 * This allows the same identity to be used on multiple devices.
 */
export const deriveKeyPair = (username: string, password: string): KeyPair => {
  // We hash the username + password to create a 32-byte seed for the keypair.
  // In a production app, we would use PBKDF2 or Argon2 with a unique salt per user.
  // For this MVP, we'll use a strong SHA-512 hash construction.
  const salt = 'p2p-identity-v1-';
  const seed = nacl.hash(util.decodeUTF8(salt + username + password)).slice(0, 32);
  
  const keyPair = nacl.box.keyPair.fromSecretKey(seed);
  
  const kp = {
    publicKey: util.encodeBase64(keyPair.publicKey),
    secretKey: util.encodeBase64(keyPair.secretKey),
  };

  // Save to local storage for speed on next refresh
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY_STORAGE_PREFIX + username, JSON.stringify(kp));
  }

  return kp;
};

// --- ROOM ENCRYPTION (Symmetric) ---

export const getOrCreateRoomKey = (roomId: string): string => {
  // For a team MVP, deriving the key from the roomId ensures everyone in the 
  // same room can decrypt the history and each other's messages reliably.
  // We use a SHA-512 hash of the roomId to create a stable 32-byte key.
  const hash = nacl.hash(util.decodeUTF8(roomId + 'p2p-salt-2026'));
  const key = hash.slice(0, 32); // Use first 32 bytes for Salsa20
  return util.encodeBase64(key);
};

export const saveRoomKey = (roomId: string, keyBase64: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(ROOM_KEY_STORAGE_PREFIX + roomId, keyBase64);
  }
};

export const encryptRoomMessage = (message: string, roomKeyBase64: string) => {
  const key = util.decodeBase64(roomKeyBase64);
  const nonce = nacl.randomBytes(24);
  const messageUint8 = util.decodeUTF8(message);
  
  const encrypted = nacl.secretbox(messageUint8, nonce, key);
  
  return {
    ciphertext: util.encodeBase64(encrypted),
    nonce: util.encodeBase64(nonce)
  };
};

export const decryptRoomMessage = (ciphertextBase64: string, nonceBase64: string, roomKeyBase64: string) => {
  const key = util.decodeBase64(roomKeyBase64);
  const ciphertext = util.decodeBase64(ciphertextBase64);
  const nonce = util.decodeBase64(nonceBase64);
  
  const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
  if (!decrypted) throw new Error('Failed to decrypt room message');
  
  return util.encodeUTF8(decrypted);
};

export const encryptFile = (data: Uint8Array, roomKeyBase64: string) => {
  const key = util.decodeBase64(roomKeyBase64);
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.secretbox(data, nonce, key);
  return {
    data: encrypted,
    nonce: util.encodeBase64(nonce)
  };
};

export const decryptFile = (encryptedData: Uint8Array, nonceBase64: string, roomKeyBase64: string) => {
  const key = util.decodeBase64(roomKeyBase64);
  const nonce = util.decodeBase64(nonceBase64);
  const decrypted = nacl.secretbox.open(encryptedData, nonce, key);
  if (!decrypted) throw new Error('Failed to decrypt file');
  return decrypted;
};

// --- P2P ENCRYPTION (Asymmetric) ---

// Encrypt a message for a specific peer
export const encryptMessage = (
  message: string,
  theirPublicKeyBase64: string,
  mySecretKeyBase64: string
) => {
  const ephemeralKeyPair = nacl.box.keyPair(); // One-time use for forward secrecy approximation
  const nonce = nacl.randomBytes(24);
  const messageUint8 = util.decodeUTF8(message);
  
  const theirPublicKey = util.decodeBase64(theirPublicKeyBase64);
  
  const encrypted = nacl.box(
    messageUint8,
    nonce,
    theirPublicKey,
    ephemeralKeyPair.secretKey
  );

  return {
    ciphertext: util.encodeBase64(encrypted),
    nonce: util.encodeBase64(nonce),
    ephemeralPubKey: util.encodeBase64(ephemeralKeyPair.publicKey),
  };
};

// Decrypt a message from a specific peer
export const decryptMessage = (
  ciphertextBase64: string,
  nonceBase64: string,
  ephemeralPubKeyBase64: string,
  mySecretKeyBase64: string
) => {
  const ciphertext = util.decodeBase64(ciphertextBase64);
  const nonce = util.decodeBase64(nonceBase64);
  const ephemeralPubKey = util.decodeBase64(ephemeralPubKeyBase64);
  const mySecretKey = util.decodeBase64(mySecretKeyBase64);

  const decrypted = nacl.box.open(
    ciphertext,
    nonce,
    ephemeralPubKey,
    mySecretKey
  );

  if (!decrypted) {
    throw new Error('Failed to decrypt message (invalid key or tampered payload)');
  }

  return util.encodeUTF8(decrypted);
};
