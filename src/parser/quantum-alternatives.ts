import { CryptoAsset } from './types';

export interface QuantumAlternativeSuggestion {
  alternative: string;
  basis: string;
}

const algorithmSpecificAlternatives: Record<string, string> = {
  rsa: 'ML-KEM (Kyber) for key establishment + ML-DSA (Dilithium) for signatures',
  ecc: 'ML-KEM (Kyber) for key establishment + ML-DSA (Dilithium) for signatures',
  ecdsa: 'ML-DSA (Dilithium) or SPHINCS+ for digital signatures',
  ecdh: 'ML-KEM (Kyber) for key establishment',
  dsa: 'ML-DSA (Dilithium) for digital signatures',
  ed25519: 'ML-DSA (Dilithium) or SPHINCS+ for digital signatures',
  x25519: 'ML-KEM (Kyber) for key establishment',
  md5: 'SHA3-256 or SHA-512 (and HMAC where authenticity is needed)',
  sha1: 'SHA3-256 or SHA-512',
  des: 'AES-256-GCM or ChaCha20-Poly1305',
  '3des': 'AES-256-GCM or ChaCha20-Poly1305',
  blowfish: 'AES-256-GCM or ChaCha20-Poly1305',
  rc4: 'AES-256-GCM or ChaCha20-Poly1305'
};

const primitiveFallbackAlternatives: Record<string, string> = {
  asymmetric: 'NIST PQC algorithms (ML-KEM / ML-DSA / SLH-DSA) based on use-case',
  'key-exchange': 'ML-KEM (Kyber) for key establishment',
  hash: 'SHA3-256 or SHA-512 depending on compatibility and performance needs',
  symmetric: 'AES-256-GCM or ChaCha20-Poly1305 with modern key management',
  mac: 'HMAC-SHA-512 or KMAC (SHA-3 family)'
};

function normalize(input?: string): string {
  return (input ?? '').trim().toLowerCase();
}

export function getQuantumAlternativeSuggestion(asset: CryptoAsset): QuantumAlternativeSuggestion {
  if (asset.quantumSafe === true) {
    return {
      alternative: 'Current algorithm is already quantum-safe',
      basis: 'No migration suggested because this detection is marked quantum-safe.'
    };
  }

  const normalizedName = normalize(asset.name);
  const normalizedPrimitive = normalize(asset.primitive || asset.type);
  const specific = algorithmSpecificAlternatives[normalizedName];
  const fallback = primitiveFallbackAlternatives[normalizedPrimitive];

  const alternative = specific ?? fallback ?? 'Use a NIST-standard post-quantum or modern vetted primitive for this use-case';

  const safetyStatus = asset.quantumSafe === false
    ? 'Detected as non-quantum-safe.'
    : asset.quantumSafe === 'partial'
      ? 'Detected as partially quantum-resistant.'
      : 'Quantum-safety status is unknown.';

  const basis = `${safetyStatus} Suggestion is selected by matching the detected algorithm name first, then falling back to its primitive category (${normalizedPrimitive || 'unknown'}) and preferring NIST-standardized or widely recommended modern algorithms.`;

  return { alternative, basis };
}
