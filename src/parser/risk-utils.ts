// src/parser/risk-utils.ts

/**
 * Assigns severity and numeric risk score based on algorithm properties.
 *
 * This replaces the placeholder UNKNOWN risk levels with real values.
 * Factors considered:
 * - Algorithm type (hash, cipher, key exchange, signature, PQC)
 * - Quantum safety classification
 * - Known cryptographic weakness or age
 */

export type SeverityLevel = 'low' | 'medium' | 'high';

export interface RiskProfile {
  severity: SeverityLevel;
  score: number; // 0–100
  explanation: string;
}

export function assignRisk(
  quantumSafe: boolean | 'partial' | 'unknown',
  type: string,
  name: string
): RiskProfile {
  let baseScore = 50;
  let explanation = 'Default base risk.';

  const lower = name.toLowerCase();

  // 🔹 Adjust base score by known algorithm weaknesses
  if (lower.includes('md5') || lower.includes('sha1') || lower.includes('des') || lower.includes('rc4')) {
    baseScore = 95;
    explanation = 'Uses cryptographically broken or obsolete algorithm.';
  } else if (lower.includes('rsa') || lower.includes('ecdsa')) {
    baseScore = 80;
    explanation = 'Classical algorithm vulnerable to quantum attacks.';
  } else if (lower.includes('aes') || lower.includes('sha256') || lower.includes('sha512')) {
    baseScore = 50;
    explanation = 'Modern algorithm with partial quantum resistance.';
  } else if (
    lower.includes('kyber') ||
    lower.includes('dilithium') ||
    lower.includes('falcon') ||
    lower.includes('sphincs')
  ) {
    baseScore = 20;
    explanation = 'Post-quantum cryptographic algorithm (PQC).';
  }

  // 🔹 Adjust for quantum safety classification
  if (quantumSafe === false) baseScore += 20;
  else if (quantumSafe === 'partial') baseScore += 10;
  else if (quantumSafe === true) baseScore -= 10;

  // 🔹 Adjust by crypto primitive type
  const t = type.toLowerCase();
  if (t.includes('cipher') || t.includes('encryption')) baseScore += 5;
  if (t.includes('signature') || t.includes('keygen')) baseScore += 10;
  if (t.includes('hash')) baseScore -= 5;

  // Clamp to 0–100
  baseScore = Math.min(100, Math.max(0, baseScore));

  // 🔹 Determine severity label
  let severity: SeverityLevel;
  if (baseScore >= 75) severity = 'high';
  else if (baseScore >= 45) severity = 'medium';
  else severity = 'low';

  return { severity, score: baseScore, explanation };
}
