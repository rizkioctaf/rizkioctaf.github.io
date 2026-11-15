/* ==========================================================================
   MESIN KRIPTOGRAFI TERPUSAT (PBKDF2 + AES-256-CBC)
   Lokasi file: website/assets/js/utils/crypto.js
   
   Tujuan utama file ini:
   Menyatukan seluruh logika penguncian (enkripsi) dan pembukaan (dekripsi) dokumen
   di satu modul. Menggunakan pustaka global CryptoJS yang dimuat di HTML.
   ========================================================================== */

import { CONFIG } from '../config.js';

/**
 * Perbandingan string berbasis constant-time untuk mencegah timing attack
 * saat memverifikasi tanda tangan integritas HMAC.
 */
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
        return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/**
 * Menurunkan kata sandi manusia menjadi pasangan kunci AES-256 dan HMAC-256.
 * Dipisahkan sebagai fungsi mandiri agar sesi login dapat menyimpan kunci turunan
 * tanpa pernah menyimpan kata sandi asli (plaintext) di memori penyimpanan browser.
 */
export function deriveSessionKeys(password, saltHex) {
    const saltWords = CryptoJS.enc.Hex.parse(saltHex);
    const masterKey = CryptoJS.PBKDF2(password, saltWords, {
        keySize: 512 / 32,
        iterations: CONFIG.PBKDF2_ITERATIONS,
        hasher: CryptoJS.algo.SHA256
    });

    const encKeyWords = CryptoJS.lib.WordArray.create(masterKey.words.slice(0, 8), 32);
    const macKeyWords = CryptoJS.lib.WordArray.create(masterKey.words.slice(8, 16), 32);

    return {
        encKeyHex: CryptoJS.enc.Hex.stringify(encKeyWords),
        macKeyHex: CryptoJS.enc.Hex.stringify(macKeyWords)
    };
}

/**
 * Mengenkripsi teks artikel mentah menggunakan skema Encrypt-then-MAC.
 */
export function encryptArticle(plaintext, password) {
    const salt = CryptoJS.lib.WordArray.random(128 / 8);
    const iv = CryptoJS.lib.WordArray.random(128 / 8);
    const saltHex = CryptoJS.enc.Hex.stringify(salt);
    const ivHex = CryptoJS.enc.Hex.stringify(iv);

    const { encKeyHex, macKeyHex } = deriveSessionKeys(password, saltHex);
    const encKey = CryptoJS.enc.Hex.parse(encKeyHex);
    const macKey = CryptoJS.enc.Hex.parse(macKeyHex);

    const encrypted = CryptoJS.AES.encrypt(plaintext, encKey, {
        iv: iv,
        padding: CryptoJS.pad.Pkcs7,
        mode: CryptoJS.mode.CBC
    });

    const ciphertextStr = encrypted.toString();
    const mac = CryptoJS.HmacSHA256(`${saltHex}:${ivHex}:${ciphertextStr}`, macKey).toString();

    return {
        salt: saltHex,
        iv: ivHex,
        ciphertext: ciphertextStr,
        mac: mac
    };
}

/**
 * Mendekripsi dokumen menggunakan kunci sesi yang sudah diturunkan (tanpa password mentah).
 * Digunakan oleh view.js untuk fitur Auto-Login sesi yang aman.
 */
export function decryptWithDerivedKeys(encData, encKeyHex, macKeyHex) {
    if (!encData || !encData.salt || !encData.iv || !encData.ciphertext) {
        throw new Error('Struktur JSON tidak valid.');
    }

    const ivWords = CryptoJS.enc.Hex.parse(encData.iv);
    const encKey = CryptoJS.enc.Hex.parse(encKeyHex);

    if (encData.mac) {
        const macKey = CryptoJS.enc.Hex.parse(macKeyHex);
        const expectedMac = CryptoJS.HmacSHA256(
            `${encData.salt}:${encData.iv}:${encData.ciphertext}`,
            macKey
        ).toString();

        if (!timingSafeEqual(expectedMac, encData.mac)) {
            throw new Error('Sesi tidak valid atau file telah dimodifikasi!');
        }
    }

    const decrypted = CryptoJS.AES.decrypt(encData.ciphertext, encKey, {
        iv: ivWords,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });

    let plaintext = '';
    try {
        plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    } catch (_) {
        throw new Error('Gagal mendekripsi sesi dokumen.');
    }

    if (!plaintext) {
        throw new Error('Dokumen kosong atau kunci sesi kedaluwarsa.');
    }

    return plaintext;
}

/**
 * Mendekripsi objek JSON artikel menggunakan kata sandi manusia.
 * Mendukung format baru (Encrypt-then-MAC) maupun format lama (Legacy tanpa MAC).
 */
export function decryptArticle(encData, password) {
    if (!encData || !encData.salt || !encData.iv || !encData.ciphertext) {
        throw new Error('Struktur JSON tidak valid atau bukan file milik SecureReader.');
    }

    if (encData.mac) {
        const { encKeyHex, macKeyHex } = deriveSessionKeys(password, encData.salt);
        return decryptWithDerivedKeys(encData, encKeyHex, macKeyHex);
    }

    // Kompatibilitas mundur untuk file lama tanpa MAC
    const saltWords = CryptoJS.enc.Hex.parse(encData.salt);
    const ivWords = CryptoJS.enc.Hex.parse(encData.iv);
    const legacyKey = CryptoJS.PBKDF2(password, saltWords, {
        keySize: CONFIG.PBKDF2_KEY_SIZE,
        iterations: CONFIG.PBKDF2_ITERATIONS,
        hasher: CryptoJS.algo.SHA256
    });

    const decrypted = CryptoJS.AES.decrypt(encData.ciphertext, legacyKey, {
        iv: ivWords,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });

    let plaintext = '';
    try {
        plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    } catch (_) {
        throw new Error('Kata sandi salah atau dokumen korup!');
    }

    if (!plaintext) {
        throw new Error('Kata sandi salah atau dokumen korup!');
    }

    return plaintext;
}