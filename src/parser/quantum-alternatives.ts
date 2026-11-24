import { CryptoAsset } from './types';

export interface QuantumAlternativeSuggestion {
  alternative: string;
  rationale: string;
}

const recommendations: Record<string, QuantumAlternativeSuggestion> = {
  rsa: {
    alternative: 'Choose by use: ML-KEM (FIPS 203) for key establishment; ML-DSA (FIPS 204) or SLH-DSA (FIPS 205) for signatures.',
    rationale: 'RSA can serve different roles. Confirm the call site, protocol, interoperability, and key lifecycle before selecting a replacement.'
  },
  ecc: {
    alternative: 'Choose by use: ML-KEM (FIPS 203) for key establishment; ML-DSA (FIPS 204) or SLH-DSA (FIPS 205) for signatures.',
    rationale: 'ECC is a family, not a single operation. Select a migration path that matches the current use and protocol.'
  },
  ecdsa: {
    alternative: 'Evaluate ML-DSA (FIPS 204) or SLH-DSA (FIPS 205) for digital signatures.',
    rationale: 'Signature format, certificate support, and interoperability need to be checked before migration.'
  },
  ed25519: {
    alternative: 'Evaluate ML-DSA (FIPS 204) or SLH-DSA (FIPS 205) for digital signatures.',
    rationale: 'Signature format, certificate support, and interoperability need to be checked before migration.'
  },
  dsa: {
    alternative: 'Evaluate ML-DSA (FIPS 204) or SLH-DSA (FIPS 205) for digital signatures.',
    rationale: 'DSA is also a legacy algorithm; review classical deprecation and quantum migration together.'
  },
  ecdh: {
    alternative: 'Evaluate ML-KEM (FIPS 203) for key establishment.',
    rationale: 'Check protocol support, hybrid migration options, and interoperability.'
  },
  x25519: {
    alternative: 'Evaluate ML-KEM (FIPS 203) for key establishment.',
    rationale: 'Check protocol support, hybrid migration options, and interoperability.'
  },
  kyber: {
    alternative: 'Verify whether this is a pre-standard Kyber implementation and assess migration to ML-KEM (FIPS 203).',
    rationale: 'The standardized algorithm is ML-KEM; parameter sets and wire formats must be verified.'
  },
  dilithium: {
    alternative: 'Verify whether this is a pre-standard Dilithium implementation and assess migration to ML-DSA (FIPS 204).',
    rationale: 'The standardized algorithm is ML-DSA; parameter sets and signature formats must be verified.'
  },
  sphincs: {
    alternative: 'Verify whether this is a pre-standard SPHINCS+ implementation and assess migration to SLH-DSA (FIPS 205).',
    rationale: 'The standardized algorithm is SLH-DSA; parameter sets and signature formats must be verified.'
  },
  falcon: {
    alternative: 'Check the current standardization status and use a conformant implementation before deployment.',
    rationale: 'The detector recognizes the algorithm family but cannot verify whether the implementation matches a finalized standard or parameter set.'
  },
  md5: {
    alternative: 'Replace according to use: a modern digest for integrity, a password-hashing scheme for passwords, or a keyed MAC for authentication.',
    rationale: 'A general-purpose hash is not a safe drop-in replacement for password storage or message authentication.'
  },
  sha1: {
    alternative: 'Replace according to use: a modern digest for integrity, a password-hashing scheme for passwords, or a keyed MAC for authentication.',
    rationale: 'SHA-1 is deprecated for collision-resistant uses; choose the replacement based on how the result is used.'
  },
  des: {
    alternative: 'Migrate to a vetted authenticated-encryption design such as AES-GCM or ChaCha20-Poly1305.',
    rationale: 'Migration also requires reviewing key management, nonce handling, and data format compatibility.'
  },
  '3des': {
    alternative: 'Migrate to a vetted authenticated-encryption design such as AES-GCM or ChaCha20-Poly1305.',
    rationale: '3DES is deprecated. Review key management, nonce handling, and data format compatibility.'
  },
  rc4: {
    alternative: 'Migrate to a vetted authenticated-encryption design such as AES-GCM or ChaCha20-Poly1305.',
    rationale: 'RC4 is unsuitable for security use; review protocol and data format compatibility.'
  }
};

export function getQuantumAlternativeSuggestion(asset: CryptoAsset): QuantumAlternativeSuggestion {
  const normalizedName = (asset.name ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const specific = recommendations[normalizedName];
  if (specific) return specific;

  if (asset.quantumImpact === 'post-quantum' || asset.quantumSafe === true) {
    return {
      alternative: 'No quantum-migration recommendation from this algorithm identification alone.',
      rationale: 'Verify the standardized algorithm variant, implementation, and protocol integration.'
    };
  }

  if (asset.quantumImpact === 'vulnerable' || asset.quantumSafe === false) {
    return {
      alternative: 'Review the cryptographic operation and evaluate a NIST-standard post-quantum algorithm for its role.',
      rationale: 'The scanner does not know enough about the operation, protocol, or deployment to choose a safe drop-in replacement.'
    };
  }

  if (asset.quantumImpact === 'reduced-strength' || asset.quantumSafe === 'partial') {
    return {
      alternative: 'No automatic replacement is recommended from this detection.',
      rationale: 'Review the exact algorithm variant, key or digest size, usage, and data security lifetime.'
    };
  }

  return {
    alternative: 'Review the use case before selecting a replacement.',
    rationale: 'The algorithm or operation was not classified well enough to make a migration recommendation.'
  };
}
