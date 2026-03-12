// src/parser/regex-detector.ts - IMPROVED with context validation
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
      
      this.rules = [];
      for (const langKey in rulesData) {
        const langRules = rulesData[langKey];
        if (Array.isArray(langRules)) {
          for (const rule of langRules) {
            const patterns = rule.patterns || [];
            if (rule.api && !patterns.includes(rule.api)) {
              patterns.push(rule.api);
            }
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
      console.log(`[RegexDetector] Loaded ${this.rules.length} detection rules`);
    } catch (err) {
      console.error('[RegexDetector] Failed to load rules:', err);
      this.rules = [];
    }
  }

  /**
   * Check if a line is likely a false positive
   */
  private isLikelyFalsePositive(line: string, pattern: string): boolean {
    const trimmed = line.trim();
    
    // Skip comments
    if (this.isComment(trimmed)) {
      return true;
    }

    // Skip documentation strings
    if (this.isDocumentation(trimmed)) {
      return true;
    }

    // Skip URLs and file paths
    if (this.isUrlOrPath(trimmed)) {
      return true;
    }

    // Skip import/require statements (unless it's a crypto library)
    if (this.isNonCryptoImport(trimmed, pattern)) {
      return true;
    }

    // Skip if pattern appears only in a string literal (not as function call)
    if (this.isOnlyInStringLiteral(trimmed, pattern)) {
      return true;
    }

    return false;
  }

  private isComment(line: string): boolean {
    // Single-line comments
    if (/^\s*(\/\/|#|;|--|'|<!--)/.test(line)) {
      return true;
    }
    
    // Multi-line comment indicators
    if (/^\s*\*/.test(line) || line.includes('/*') || line.includes('*/')) {
      return true;
    }
    
    return false;
  }

  private isDocumentation(line: string): boolean {
    // Python docstrings
    if (/^\s*("""|\'\'\')/.test(line)) {
      return true;
    }
    
    // JSDoc
    if (/^\s*\*\s*@(param|return|description|example)/.test(line)) {
      return true;
    }
    
    return false;
  }

  private isUrlOrPath(line: string): boolean {
    // URLs
    if (/https?:\/\//.test(line) || /www\./.test(line)) {
      return true;
    }
    
    // File paths
    if (/[\\\/].*\.(json|txt|md|log|xml)/.test(line)) {
      return true;
    }
    
    return false;
  }

  private isNonCryptoImport(line: string, pattern: string): boolean {
    // Python imports (but allow crypto library imports)
    if (/^\s*(import|from)\s+/.test(line)) {
      // Allow: from cryptography import ..., import hashlib, etc.
      if (/\b(crypto|hash|cipher|hmac|ecdsa)\b/i.test(line)) {
        return false;
      }
      return true;
    }
    
    // JavaScript imports (but allow crypto imports)
    if (/^\s*(import|require|export)\s+/.test(line)) {
      if (/\b(crypto|hash|cipher)\b/i.test(line)) {
        return false;
      }
      return true;
    }
    
    return false;
  }

  private isOnlyInStringLiteral(line: string, pattern: string): boolean {
    // Remove all string literals and check if pattern still exists
    const withoutStrings = line
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, "''")
      .replace(/`[^`]*`/g, '``');
    
    const regex = new RegExp(`\\b${this.escapeRegex(pattern)}\\b`, 'i');
    
    // If pattern doesn't exist after removing strings, it was only in strings
    if (!regex.test(withoutStrings)) {
      // But allow if it looks like an API call in the original
      if (this.looksLikeApiCall(line, pattern)) {
        return false;
      }
      return true;
    }
    
    return false;
  }

  private looksLikeApiCall(line: string, pattern: string): boolean {
    const regex = new RegExp(`\\b${this.escapeRegex(pattern)}\\s*[\\(\\.]`, 'i');
    return regex.test(line);
  }

  /**
   * Check if line contains actual crypto usage (API call, assignment, etc.)
   */
  private hasValidCryptoContext(line: string, pattern: string): boolean {
    const escapedPattern = this.escapeRegex(pattern);
    const regex = new RegExp(`\\b${escapedPattern}\\b`, 'i');
    
    // Must match the pattern
    if (!regex.test(line)) {
      return false;
    }

    // Valid contexts:
    // 1. Direct function/method call: pattern(, foo.pattern(, pattern.
    if (
      new RegExp(`\\b${escapedPattern}\\s*\\(`, 'i').test(line) ||
      new RegExp(`\\.\\s*${escapedPattern}\\s*\\(`, 'i').test(line) ||
      new RegExp(`\\b${escapedPattern}\\s*\\.`, 'i').test(line)
    ) {
      return true;
    }

    // 2. Assignment: = pattern, : pattern
    if (new RegExp(`[=:]\\s*.*\\b${escapedPattern}\\b`, 'i').test(line)) {
      return true;
    }

    // 3. Method chaining: .pattern
    if (new RegExp(`\\.\\s*${escapedPattern}\\b`, 'i').test(line)) {
      return true;
    }

    // 4. Instantiation: new pattern
    if (new RegExp(`new\\s+${escapedPattern}\\b`, 'i').test(line)) {
      return true;
    }

    // 5. String that looks like algorithm name in crypto API
    if (/['"](md5|sha1|sha256|sha512|aes|rsa|des|3des|ecdsa)['"]/i.test(line)) {
      // But must have crypto context nearby
      if (/\b(hash|digest|cipher|encrypt|decrypt|sign|verify|key|algorithm|crypto)\b/i.test(line)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create a strong detection key to avoid duplicates
   */
  private createDetectionKey(rule: string, filename: string, lineNumber: number, snippet: string): string {
    // Use first 50 chars of snippet to differentiate multiple uses on same line
    const snippetHash = snippet.trim().substring(0, 50);
    return `${rule}::${path.basename(filename)}::${lineNumber}::${snippetHash}`;
  }

  private patternToRegex(pattern: string): RegExp {
    const trimmed = (pattern || '').trim();
    const wildcardEscaped = trimmed
      .split('*')
      .map((part) => this.escapeRegex(part))
      .join('.*');

    const source = /^\w+$/.test(trimmed) ? `\\b${wildcardEscaped}\\b` : wildcardEscaped;
    return new RegExp(source, 'i');
  }

  scan(content: string, filename: string): CryptoAsset[] {
    const results: CryptoAsset[] = [];
    const lines = content.split("\n");
    const seenDetections = new Set<string>();

    console.log(`[RegexDetector] Scanning ${path.basename(filename)} (${lines.length} lines)`);

    for (const rule of this.rules) {
      const patterns = rule.patterns || [rule.name];
      
      for (const pattern of patterns) {
        let regex: RegExp;
        try {
          // Supports wildcard rule signatures such as Cipher.*AES and EVP_aes_*.
          // NOTE: no global flag here, otherwise `.test()` can skip lines due to lastIndex state.
          regex = this.patternToRegex(pattern);
        } catch (err) {
          console.warn(`[RegexDetector] Invalid pattern: ${pattern}`);
          continue;
        }

        let matchCount = 0;

        lines.forEach((line, index) => {
          if (!regex.test(line)) {
            return;
          }

          const lineNumber = index + 1;
          const snippet = line.trim();

          // Skip false positives
          if (this.isLikelyFalsePositive(line, pattern)) {
            return;
          }

          // Require valid crypto context
          if (!this.hasValidCryptoContext(line, pattern)) {
            return;
          }

          // Create strong detection key
          const detectionKey = this.createDetectionKey(rule.name, filename, lineNumber, snippet);
          
          if (seenDetections.has(detectionKey)) {
            return;
          }
          seenDetections.add(detectionKey);

          matchCount++;

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
            id: `regex:${rule.name.toLowerCase()}-${path.basename(filename)}-${lineNumber}`,
            detectionContexts: [
              {
                filePath: filename,
                lineNumbers: [lineNumber],
                snippet: snippet.substring(0, 300)
              }
            ]
          });
        });

        if (matchCount > 0) {
          console.log(`  ✓ ${rule.name}: ${matchCount} valid detection(s)`);
        }
      }
    }

    console.log(`[RegexDetector] Found ${results.length} valid detections in ${path.basename(filename)}`);
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
