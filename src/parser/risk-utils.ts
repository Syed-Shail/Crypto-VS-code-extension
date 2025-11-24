export type Severity = "none" | "low" | "medium" | "high" | "critical";

export interface CryptoAsset {
  name: string;
  type: string;
  source: string;
  quantumSafe: boolean | "partial" | "unknown";
  severity?: Severity;
  score?: number;
  reason?: string;
  line?: number;
}

export interface RiskResult {
  severity: Severity;
  score: number;
  explanation: string;
}

/**
 * assignRisk - basic heuristic mapping for quantumSafe / type to severity & score.
 * Keep this lightweight; callers expect { severity, score, explanation }.
 */
export function assignRisk(
  quantumSafe: boolean | "partial" | "unknown" | undefined,
  type?: string,
  name?: string
): RiskResult {
  // Default
  let severity: Severity = "low";
  let score = 10;
  let explanation = "Low risk / information-only detection.";

  // If explicitly flagged not quantum-safe or legacy/insecure types
  if (quantumSafe === false) {
    severity = "high";
    score = 90;
    explanation = `${name ?? "Algorithm"} is not quantum-safe or is considered insecure/legacy.`;
  } else if (quantumSafe === "partial") {
    severity = "medium";
    score = 55;
    explanation = `${name ?? "Algorithm"} has partial quantum resistance or mixed recommendations.`;
  } else if (quantumSafe === true) {
    severity = "low";
    score = 10;
    explanation = `${name ?? "Algorithm"} is considered quantum-safe (post-quantum).`;
  } else {
    // unknown fallback: use type heuristics
    if (type && /md5|sha1|rc4|des|3des|des-ede3|rc2/i.test(type + "")) {
      severity = "high";
      score = 90;
      explanation = `${name ?? "Algorithm"} appears to be a legacy/insecure primitive.`;
    } else {
      severity = "low";
      score = 10;
      explanation = `No high severity indicators found for ${name ?? "algorithm"}.`;
    }
  }

  return { severity, score, explanation };
}
