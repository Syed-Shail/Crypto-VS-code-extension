// Mixed-language crypto signature corpus for detector validation.
// Intentionally includes API signatures from python/java/c/cpp/js rule sets.

const crypto = require('crypto');

const md5Hash = crypto.createHash('md5');
const sha1Hash = crypto.createHash('sha1');
const sha256Hash = crypto.createHash('sha256');
const sha512Hash = crypto.createHash('sha512');

const sha224Obj = hashlib.sha224(data);
const sha384Obj = hashlib.sha384(data);
const sha3_256Obj = hashlib.sha3_256(data);
const sha3_512Obj = hashlib.sha3_512(data);
const blake2bObj = hashlib.blake2b(data);
const blake2sObj = hashlib.blake2s(data);

const hmacObj = hmac.new(key, data, hashlib.sha256);

const aesCipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const desCipher = Cipher.getInstance("DES");
const tripleDesCipher = Cipher.getInstance("DESede");
const blowfishCipher = Crypto.Cipher.Blowfish.new(key);
const rc4Cipher = Crypto.Cipher.ARC4.new(key);
const chacha20Cipher = EVP_chacha20();

const rsaKeys = crypto.generateKeyPair('rsa', { modulusLength: 2048 });
const dsaKeys = Crypto.PublicKey.DSA.generate(2048);
const eccKeys = Crypto.PublicKey.ECC.generate(curve='P-256');
const ecdsaKeys = KeyPairGenerator.getInstance("EC");
const ed25519Keys = Ed25519.generate();
const x25519Keys = X25519.generate();

const kyberKem = Kyber.encapsulate(publicKey);
const dilithiumSig = Dilithium.sign(message, privateKey);
const falconSig = Falcon.sign(message, privateKey);
const sphincsSig = SPHINCS.sign(message, privateKey);

const opensslMd5 = EVP_md5();
const opensslSha1 = EVP_sha1();
const opensslSha256 = EVP_sha256();
const opensslSha512 = EVP_sha512();
const opensslAes = EVP_aes_256_gcm();
const opensslDes = EVP_des_ede3();
const opensslRsa = RSA_generate_key_ex(2048, 65537, NULL);

MessageDigest.getInstance("SHA-256");
MessageDigest.getInstance("SHA-1");
MessageDigest.getInstance("MD5");
Mac.getInstance("HmacSHA256");
