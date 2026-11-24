import { Severity } from './types';

export interface RiskResult {
  severity: Severity;
  explanation: string;
  classicalSecurityStatus: 'broken' | 'deprecated' | 'no-known-weakness' | 'unknown';
  quantumImpact: 'vulnerable' | 'reduced-strength' | 'post-quantum' | 'unknown';
}

/**
 * Assign classical-security severity independently from quantum impact.
 */
export function assignRisk(
  quantumSafe: boolean | "partial" | "unknown" | undefined,
  type?: string,
  name?: string
): RiskResult {
  const algorithm = (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const broken = new Set(['md5', 'des', 'rc4', 'arc4']);
  const deprecated = new Set(['sha1', '3des', 'tripledes', 'des3', 'desede', 'blowfish', 'dsa', 'rc2']);
  const assessed = new Set([
    'aes', 'aes128', 'aes192', 'aes256', 'sha224', 'sha256', 'sha384', 'sha512', 'sha3256', 'sha3512',
    'blake2b', 'blake2s', 'hmac', 'chacha20', 'chacha20poly1305', 'rsa', 'ecc', 'ecdsa', 'ecdh',
    'ed25519', 'x25519', 'x448', 'kyber', 'mlkem', 'dilithium', 'mldsa', 'falcon', 'sphincs', 'slhdsa'
  ]);
  const classicalSecurityStatus = broken.has(algorithm)
    ? 'broken'
    : deprecated.has(algorithm)
      ? 'deprecated'
      : assessed.has(algorithm)
        ? 'no-known-weakness'
        : 'unknown';

  const quantumImpact = quantumSafe === false
    ? 'vulnerable'
    : quantumSafe === 'partial'
      ? 'reduced-strength'
      : quantumSafe === true
        ? 'post-quantum'
        : 'unknown';

  let severity: Severity;
  let explanation: string;
  if (classicalSecurityStatus === 'broken') {
    severity = 'high';
    explanation = `${name} is considered cryptographically broken or unsuitable for security use.`;
  } else if (classicalSecurityStatus === 'deprecated') {
    severity = 'medium';
    explanation = `${name} is a legacy or deprecated algorithm; review its use and migration requirements.`;
  } else if (classicalSecurityStatus === 'unknown') {
    severity = 'unknown';
    explanation = 'The algorithm could not be assessed from the available identification.';
  } else {
    severity = 'none';
    explanation = `No cataloged classical weakness was identified for ${name}; this does not validate its configuration or use.`;
  }

  // Quantum exposure is reported separately: it is a migration planning signal,
  // not proof of a current classical cryptographic break.
  return { severity, explanation, classicalSecurityStatus, quantumImpact };
}
