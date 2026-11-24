export type Severity = "unknown" | "none" | "low" | "medium" | "high";
export type ClassicalSecurityStatus = "broken" | "deprecated" | "no-known-weakness" | "unknown";
export type QuantumImpact = "vulnerable" | "reduced-strength" | "post-quantum" | "unknown";

/** Minimal canonical CryptoAsset used by detectors.
 *  Note: several modules historically used `type` while others used `primitive`.
 *  We accept both and add CBOM/UI fields.
 */
export interface CryptoAsset {
  name: string;
  primitive?: string;
  type?: string;

  // CBOM / UI fields
  assetType?: string;            // e.g. "algorithm"
  description?: string;
  id?: string;                   // unique id used in reports e.g. "regex:md5-0"
  occurrences?: number;          // number of times detected overall
  detectionContexts?: Array<{
    filePath?: string;
    lineNumbers?: number[];
    snippet?: string;
    startOffset?: number;
    endOffset?: number;
  }>;

  source?: string;
  quantumSafe?: boolean | "partial" | "unknown";
  severity?: Severity;
  /** @deprecated Uncalibrated numeric risk scores are no longer emitted. */
  score?: number;
  /** @deprecated Uncalibrated numeric risk scores are no longer emitted. */
  riskScore?: number;
  reason?: string;
  line?: number;
  column?: number;
  startOffset?: number;
  endOffset?: number;
  /** Classical algorithm status and quantum migration exposure are separate assessments. */
  classicalSecurityStatus?: ClassicalSecurityStatus;
  quantumImpact?: QuantumImpact;
  confidence?: 'high' | 'medium' | 'low' | 'unknown';
  detectionMethod?: 'syntax-call' | 'text-rule' | 'dependency' | 'configuration' | 'manual';
}

/** Rule structure used by regex + AST detectors.
 */
export interface DetectionRule {
  name: string;
  primitive?: string;
  type?: string;
  quantumSafe?: boolean | "partial" | "unknown";
  patterns: string[];
  description?: string;
}
