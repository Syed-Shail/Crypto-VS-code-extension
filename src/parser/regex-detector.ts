// src/parser/regex-detector.ts
import { CryptoAsset, Severity } from "./types";
import { assignRisk } from "./risk-utils";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

interface DetectionRule {
  name: string;
  primitive?: string;
  type?: string;
  quantumSafe?: boolean | "partial" | "unknown";
  patterns: string[];
  description?: string;
  api?: string;
  severity?: string;
  recommendation?: string;
}

export class RegexDetector {
  private rules: DetectionRule[];

  constructor() {
    const rulesPath = path.join(__dirname, "rules", "crypto-rules.json");
    try {
      const rulesData = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
      
      // Flatten all language-specific rules into a single array
      this.rules = [];
      for (const langKey in rulesData) {
        const langRules = rulesData[langKey];
        if (Array.isArray(langRules)) {
          for (const rule of langRules) {
            // Convert api field to patterns array
            const patterns = rule.patterns || [];
            if (rule.api && !patterns.includes(rule.api)) {
              patterns.push(rule.api);
            }
            // Also add the name as a pattern
            if (rule.name && !patterns.includes(rule.name)) {
              patterns.push(rule.name);
            }
            
            this.rules.push({
              ...rule,
              patterns: patterns.length > 0 ? patterns : [rule.api || rule.name]
            });
          }
        }
      }
    } catch (err) {
      console.error('[RegexDetector] Failed to load rules:', err);
      this.rules = [];
    }
  }

  scan(content: string, filename: string): CryptoAsset[] {
    const results: CryptoAsset[] = [];
    const lines = content.split("\n");
    const seenDetections = new Set<string>();

    for (const rule of this.rules) {
      const patterns = rule.patterns || [rule.name];
      
      for (const pattern of patterns) {
        // Escape special regex characters if the pattern isn't already a regex
        let regex: RegExp;
        try {
          regex = new RegExp(`\\b${this.escapeRegex(pattern)}\\b`, "gi");
        } catch (err) {
          console.warn(`[RegexDetector] Invalid pattern: ${pattern}`);
          continue;
        }

        lines.forEach((line, index) => {
          const matches = line.match(regex);
          if (matches) {
            const lineNumber = index + 1;
            const snippet = line.trim();
            
            // Create unique key to avoid duplicates
            const detectionKey = `${rule.name}-${filename}-${lineNumber}`;
            if (seenDetections.has(detectionKey)) {
              return;
            }
            seenDetections.add(detectionKey);

            const risk = assignRisk(
              rule.quantumSafe, 
              rule.type ?? rule.primitive, 
              rule.name
            );

            results.push({
              name: rule.name,
              type: rule.type ?? rule.primitive ?? 'unknown',
              primitive: rule.primitive ?? rule.type ?? 'unknown',
              assetType: "algorithm",
              description: rule.description ?? "",
              quantumSafe: rule.quantumSafe ?? 'unknown',
              severity: risk.severity as Severity,
              score: risk.score,
              riskScore: risk.score,
              reason: risk.explanation,
              source: filename,
              line: lineNumber,
              occurrences: 1,
              id: `regex:${(rule.name || 'unknown').toLowerCase()}-${lineNumber}`,
              detectionContexts: [
                {
                  filePath: filename,
                  lineNumbers: [lineNumber],
                  snippet
                }
              ]
            });
          }
        });
      }
    }

    return results;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
    try {
      const text = fs.readFileSync(uri.fsPath, "utf8");
      return this.scan(text, uri.fsPath);
    } catch (err) {
      console.error(`[RegexDetector] Failed to read file ${uri.fsPath}:`, err);
      return [];
    }
  }
}

export const regexDetector = new RegexDetector(); 