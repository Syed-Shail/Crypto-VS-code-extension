// src/parser/regex-detector.ts
import { DetectionRule, CryptoAsset, Severity } from "./types";
import { assignRisk } from "./risk-utils";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export class RegexDetector {
  private rules: DetectionRule[];

  constructor() {
    const rulesPath = path.join(__dirname, "rules", "crypto-rules.json");
    this.rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  }

  scan(content: string, filename: string): CryptoAsset[] {
    const results: CryptoAsset[] = [];
    const lines = content.split("\n");

    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        const regex = new RegExp(pattern, "i");

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            const risk = assignRisk(rule.quantumSafe, rule.type ?? rule.primitive, rule.name);
            const lineNumber = index + 1;
            const snippet = line.trim();

            results.push({
              name: rule.name,
              type: rule.type ?? rule.primitive,
              primitive: rule.primitive ?? rule.type,
              assetType: "algorithm",
              description: rule.description ?? "",
              quantumSafe: rule.quantumSafe,
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

  async detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
    const text = fs.readFileSync(uri.fsPath, "utf8");
    return this.scan(text, uri.fsPath);
  }
}

export const regexDetector = new RegexDetector();
