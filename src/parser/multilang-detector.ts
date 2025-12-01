// src/parser/multilang-detector.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CryptoAsset, Severity } from "./types";
import { assignRisk } from "./risk-utils";
import { getParserForExtension } from "./ts-wasm";

const rulesPath = path.join(__dirname, "rules", "crypto-rules.json");
let CRYPTO_RULES: any = {};

// Load rules safely
try {
  if (fs.existsSync(rulesPath)) {
    CRYPTO_RULES = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    console.log('[MULTILANG] ✅ Loaded crypto-rules.json');
  } else {
    console.warn('[MULTILANG] ⚠️  crypto-rules.json not found at:', rulesPath);
  }
} catch (err) {
  console.error('[MULTILANG] ❌ Failed to load crypto-rules.json:', err);
}

function escapeRegExp(str: string): string {
  if (!str || typeof str !== 'string') {
    return '';
  }
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function detectMultiLang(uri: vscode.Uri): Promise<CryptoAsset[]> {
  try {
    const ext = path.extname(uri.fsPath);
    const parserInfo = await getParserForExtension(ext).catch(() => null);

    if (!parserInfo) {
      console.log(`[MULTILANG] No parser available for ${ext}`);
      return [];
    }

    const { langKey, parser } = parserInfo;
    const langRules = CRYPTO_RULES[langKey] || [];

    if (!langRules || langRules.length === 0) {
      console.log(`[MULTILANG] No rules found for ${langKey}`);
      return [];
    }

    console.log(`[MULTILANG] Scanning with ${langKey} parser (${langRules.length} rules)`);

    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    
    if (!text || text.length === 0) {
      return [];
    }

    const tree = parser.parse(text);
    const results: CryptoAsset[] = [];
    const seenDetections = new Set<string>();

    function walk(node: any) {
      if (!node) return;
      
      try {
        const snippet = text.slice(node.startIndex, node.endIndex);
        if (!snippet) return;

        for (const rule of langRules) {
          if (!rule || !rule.name) continue;
          
          try {
            const escaped = escapeRegExp(rule.name);
            if (!escaped) continue;
            
            const pattern = new RegExp(`\\b${escaped}\\b`, "i");

            if (pattern.test(snippet)) {
              const line = text.substring(0, node.startIndex).split("\n").length || 1;
              
              // Avoid duplicates
              const detectionKey = `${rule.name}-${uri.fsPath}-${line}`;
              if (seenDetections.has(detectionKey)) continue;
              seenDetections.add(detectionKey);

              const risk = assignRisk(rule.quantumSafe, rule.type ?? rule.primitive, rule.name);

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
                source: uri.fsPath,
                line,
                occurrences: 1,
                id: `ast:${(rule.name || 'unknown').toLowerCase()}-${line}`,
                detectionContexts: [
                  {
                    filePath: uri.fsPath,
                    lineNumbers: [line],
                    snippet: snippet.substring(0, 300)
                  }
                ]
              });
            }
          } catch (err) {
            console.warn('[MULTILANG] Pattern error for rule:', rule.name, err);
          }
        }

        // Recursively walk children
        if (node.childCount) {
          for (let i = 0; i < node.childCount; i++) {
            walk(node.child(i));
          }
        }
      } catch (err) {
        console.warn('[MULTILANG] Error walking node:', err);
      }
    }

    walk(tree.rootNode);

    // Text fallback for patterns that might be missed by AST
    for (const rule of langRules) {
      if (!rule || !rule.name) continue;
      
      try {
        const escaped = escapeRegExp(rule.name);
        if (!escaped) continue;
        
        const re = new RegExp(`\\b${escaped}\\b`, "gi");
        let match: RegExpExecArray | null;

        while ((match = re.exec(text)) !== null) {
          const index = match.index;
          const line = text.substring(0, index).split("\n").length || 1;
          
          // Avoid duplicates
          const detectionKey = `${rule.name}-${uri.fsPath}-${line}`;
          if (seenDetections.has(detectionKey)) continue;
          seenDetections.add(detectionKey);

          const risk = assignRisk(rule.quantumSafe, rule.type ?? rule.primitive, rule.name);
          const snippetStart = Math.max(0, index - 50);
          const snippetEnd = Math.min(text.length, index + 200);
          const snippet = text.substring(snippetStart, snippetEnd);

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
            source: uri.fsPath,
            line,
            occurrences: 1,
            id: `text:${(rule.name || 'unknown').toLowerCase()}-${line}`,
            detectionContexts: [
              {
                filePath: uri.fsPath,
                lineNumbers: [line],
                snippet
              }
            ]
          });
        }
      } catch (err) {
        console.warn('[MULTILANG] Text pattern error for rule:', rule.name, err);
      }
    }

    console.log(`[MULTILANG] ✅ Found ${results.length} algorithms`);
    return results;
  } catch (err) {
    console.error('[MULTILANG] detectMultiLang error:', err);
    return [];
  }
}