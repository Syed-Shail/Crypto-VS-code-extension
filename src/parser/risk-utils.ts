// src/parser/risk-utils.ts

export type QuantumSafety = boolean | 'partial' | 'unknown';

export interface RiskResult {
  severity: 'low' | 'medium' | 'high';
  score: number;
}

/**
 * Assigns severity and numeric risk score based on quantum safety + algorithm type.
 */
export function assignRisk(
  quantumSafe: QuantumSafety,
  type: string
): RiskResult {
  let score = 0;
  let severity: 'low' | 'medium' | 'high' = 'low';

  if (quantumSafe === false) {
    score = 90;
    severity = 'high';
  } else if (quantumSafe === 'partial') {
    score = 60;
    severity = 'medium';
  } else if (quantumSafe === true) {
    score = 20;
    severity = 'low';
  } else {
    score = 50;
    severity = 'medium';
  }

  // Fine-tune scoring by primitive type
  if (type.toLowerCase().includes('asymmetric') || type.toLowerCase().includes('keygen')) score += 10;
  if (type.toLowerCase().includes('hash')) score -= 10;
  if (score > 100) score = 100;

  return { severity, score };
}
