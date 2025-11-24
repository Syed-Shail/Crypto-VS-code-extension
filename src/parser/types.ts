export type Severity = "low" | "medium" | "high" | "none";

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
  }>;

  source?: string;
  quantumSafe?: boolean | "partial" | "unknown";
  severity?: Severity;
  score?: number;                // legacy detector numeric score
  riskScore?: number;            // canonical risk score used by UI/report
  reason?: string;
  line?: number;
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
