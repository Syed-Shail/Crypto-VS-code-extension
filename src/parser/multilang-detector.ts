// src/parser/multilang-detector.ts - IMPROVED without duplicate text fallback
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CryptoAsset, Severity } from "./types";
import { assignRisk } from "./risk-utils";
import { getParserForExtension, getParsers, WasmLang } from "./ts-wasm";

const rulesPath = path.join(__dirname, "rules", "crypto-rules.json");
let CRYPTO_RULES: any = {};

try {
  if (fs.existsSync(rulesPath)) {
    CRYPTO_RULES = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    console.log('[MULTILANG] ✅ Loaded crypto-rules.json');
  }
} catch (err) {
  console.error('[MULTILANG] ❌ Failed to load crypto-rules.json:', err);
}

function escapeRegExp(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check if node represents actual crypto usage
 */
function isValidCryptoNode(node: any, text: string, ruleName: string): boolean {
  if (!node) return false;
  
  const nodeType = node.type?.toLowerCase() || '';
  const snippet = text.slice(node.startIndex, node.endIndex);
  
  // Valid node types for crypto usage
  const validTypes = [
    'call_expression',          // function calls
    'method_invocation',        // Java methods
    'function_call',            // Python calls
    'import_statement',         // imports (but check if crypto-related)
    'assignment',               // variable assignments
    'variable_declarator',      // variable declarations
    'string_literal'            // only if in crypto context
  ];
  
  // Skip if node type is too generic
  if (nodeType === 'identifier' || nodeType === 'property_identifier') {
    // These are only valid if parent is a call/assignment
    return false;
  }
  
  // Check if it's in a comment (AST should handle this, but double-check)
  if (nodeType.includes('comment')) {
    return false;
  }
  
  // For string literals, require crypto context
  if (nodeType.includes('string')) {
    const parent = getNodeContext(node, text);
    return parent.includes('getInstance') || 
           parent.includes('createHash') ||
           parent.includes('createCipher') ||
           /\b(hash|digest|cipher|encrypt|algorithm)\b/i.test(parent);
  }
  
  return true;
}

function getNodeContext(node: any, text: string): string {
  // Get surrounding 100 chars for context
  const start = Math.max(0, node.startIndex - 50);
  const end = Math.min(text.length, node.endIndex + 50);
  return text.slice(start, end);
}

export async function detectMultiLang(uri: vscode.Uri, preferredLangKey?: WasmLang): Promise<CryptoAsset[]> {
  try {
    const ext = path.extname(uri.fsPath);
    let parserInfo = await getParserForExtension(ext).catch(() => null);

    if (preferredLangKey) {
      const parsers = await getParsers();
      const preferredParser = parsers[preferredLangKey];
      if (preferredParser) {
        parserInfo = { langKey: preferredLangKey, parser: preferredParser };
      }
    }

    if (!parserInfo) {
      return []; // No parser available, let regex handle it
    }

    const { langKey, parser } = parserInfo;
    const langRules = CRYPTO_RULES[langKey] || [];

    if (!langRules || langRules.length === 0) {
      return [];
    }

    console.log(`[MULTILANG] AST scanning with ${langKey} parser`);

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
        if (!snippet || snippet.length > 1000) { // Skip huge nodes
          // Still walk children
          if (node.childCount) {
            for (let i = 0; i < node.childCount; i++) {
              walk(node.child(i));
            }
          }
          return;
        }

        for (const rule of langRules) {
          if (!rule || !rule.name) continue;
          
          try {
            const escaped = escapeRegExp(rule.name);
            if (!escaped) continue;
            
            const pattern = new RegExp(`\\b${escaped}\\b`, "i");

            if (pattern.test(snippet)) {
              // Validate this is a real crypto usage
              if (!isValidCryptoNode(node, text, rule.name)) {
                continue;
              }

              const line = text.substring(0, node.startIndex).split("\n").length || 1;
              
              // Strong deduplication key
              const snippetHash = snippet.trim().substring(0, 100).replace(/\s+/g, ' ');
              const detectionKey = `${rule.name}:${path.basename(uri.fsPath)}:${line}:${snippetHash}`;
              
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
                id: `ast:${(rule.name || 'unknown').toLowerCase()}-${path.basename(uri.fsPath)}-${line}`,
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
            // Skip this rule
          }
        }

        // Recursively walk children
        if (node.childCount) {
          for (let i = 0; i < node.childCount; i++) {
            walk(node.child(i));
          }
        }
      } catch (err) {
        // Continue walking
      }
    }

    walk(tree.rootNode);

    // NO TEXT FALLBACK - Let regex detector handle patterns missed by AST
    // This prevents duplicates since regex detector is always run anyway

    console.log(`[MULTILANG] ✅ AST found ${results.length} detections`);
    return results;
  } catch (err) {
    console.error('[MULTILANG] detectMultiLang error:', err);
    return [];
  }
}
