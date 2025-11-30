// src/parser/multilang-detector.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CryptoAsset, Severity } from "./types";
import { assignRisk } from "./risk-utils";
import { getParserForExtension } from "./ts-wasm";

const rulesPath = path.join(__dirname, "rules", "crypto-rules.json");

let CRYPTO_RULES: Record<string, any[]> = {};

// Load rules safely
try {
  if (fs.existsSync(rulesPath)) {
    CRYPTO_RULES = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    console.log(`[multilang-detector] ✅ Loaded rules for: ${Object.keys(CRYPTO_RULES).join(', ')}`);
  } else {
    console.warn(`[multilang-detector] ⚠️ Rules file not found: ${rulesPath}`);
  }
} catch (err) {
  console.error(`[multilang-detector] ❌ Failed to load rules:`, err);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\");
}

export async function detectMultiLang(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const ext = path.extname(uri.fsPath);
  
  console.log(`[multilang-detector] 🔍 Attempting to parse ${path.basename(uri.fsPath)} (${ext})`);
  
  try {
    const parserInfo = await getParserForExtension(ext);
    
    if (!parserInfo) {
      console.log(`[multilang-detector] ⚠️ No WASM parser available for ${ext}, skipping AST detection`);
      return [];
    }

    const { langKey, parser } = parserInfo;
    const langRules = CRYPTO_RULES[langKey] || [];

    if (langRules.length === 0) {
      console.log(`[multilang-detector] ⚠️ No rules defined for ${langKey}`);
      return [];
    }

    console.log(`[multilang-detector] ✅ Using ${langKey} parser with ${langRules.length} rules`);

    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    
    let tree;
    try {
      tree = parser.parse(text);
      console.log(`[multilang-detector] ✅ Successfully parsed AST`);
    } catch (parseErr) {
      console.warn(`[multilang-detector] ❌ Parse error for ${uri.fsPath}:`, parseErr);
      return [];
    }

    const results: CryptoAsset[] = [];
    const foundIds = new Set<string>();

    // AST-based detection
    function walk(node: any): void {
      if (!node) return;

      try {
        const snippet = text.slice(node.startIndex, node.endIndex);

        for (const rule of langRules) {
          if (!rule.name && !rule.api) continue;

          // Check for API signatures first (more specific)
          if (rule.api) {
            const apiPattern = new RegExp(`\\b${escapeRegExp(rule.api)}\\b`, "i");
            if (apiPattern.test(snippet)) {
              addDetection(rule, node, snippet, text, uri, foundIds, results, 'api');
              continue;
            }
          }

          // Then check for algorithm names
          if (rule.name) {
            const pattern = new RegExp(`\\b${escapeRegExp(rule.name)}\\b`, "i");
            if (pattern.test(snippet)) {
              addDetection(rule, node, snippet, text, uri, foundIds, results, 'name');
            }
          }
        }

        // Recursively walk child nodes
        if (node.childCount > 0) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
              walk(child);
            }
          }
        }
      } catch (err) {
        console.warn(`[multilang-detector] ⚠️ Error processing node:`, err);
      }
    }

    walk(tree.rootNode);

    // Regex fallback for patterns missed by AST
    console.log(`[multilang-detector] 🔍 Running regex fallback scan...`);
    
    for (const rule of langRules) {
      if (!rule.name && !rule.api) continue;

      const searchTerm = rule.api || rule.name;
      const re = new RegExp(`\\b${escapeRegExp(searchTerm)}\\b`, "gi");
      let match: RegExpExecArray | null;

      while ((match = re.exec(text)) !== null) {
        const index = match.index;
        const line = text.substring(0, index).split("\n").length || 1;
        const id = `text:${(rule.name || rule.api || 'unknown').toLowerCase()}-${line}`;

        if (!foundIds.has(id)) {
          foundIds.add(id);
          
          const risk = assignRisk(
            rule.quantumSafe, 
            rule.type ?? rule.primitive, 
            rule.name || rule.api
          );
          
          const snippetStart = Math.max(0, index);
          const snippetEnd = Math.min(text.length, index + 200);
          const snippet = text.substring(snippetStart, snippetEnd);

          results.push({
            name: rule.name || rule.api,
            type: rule.type ?? rule.primitive,
            primitive: rule.primitive ?? rule.type,
            assetType: "algorithm",
            description: rule.description ?? "",
            quantumSafe: rule.quantumSafe,
            severity: risk.severity as Severity,
            score: risk.score,
            riskScore: risk.score,
            reason: risk.explanation,
            source: uri.fsPath,
            line,
            occurrences: 1,
            id,
            detectionContexts: [
              {
                filePath: uri.fsPath,
                lineNumbers: [line],
                snippet
              }
            ]
          });
        }
      }
    }

    console.log(`[multilang-detector] ✅ Found ${results.length} algorithms in ${path.basename(uri.fsPath)}`);
    return results;

  } catch (err) {
    console.error(`[multilang-detector] ❌ Error processing ${uri.fsPath}:`, err);
    return [];
  }
}

/**
 * Helper function to add a detection result
 */
function addDetection(
  rule: any,
  node: any,
  snippet: string,
  text: string,
  uri: vscode.Uri,
  foundIds: Set<string>,
  results: CryptoAsset[],
  detectionType: 'api' | 'name'
): void {
  try {
    const line = text.substring(0, node.startIndex).split("\n").length || 1;
    const id = `ast:${(rule.name || rule.api || 'unknown').toLowerCase()}-${line}`;
    
    if (foundIds.has(id)) return;
    
    foundIds.add(id);
    
    const risk = assignRisk(
      rule.quantumSafe, 
      rule.type ?? rule.primitive, 
      rule.name || rule.api
    );

    const displayName = rule.name || rule.api;
    const cleanSnippet = snippet.substring(0, 300).replace(/\s+/g, ' ').trim();

    results.push({
      name: displayName,
      type: rule.type ?? rule.primitive,
      primitive: rule.primitive ?? rule.type,
      assetType: "algorithm",
      description: rule.description ?? `${detectionType === 'api' ? 'API call' : 'Algorithm'} detected`,
      quantumSafe: rule.quantumSafe,
      severity: risk.severity as Severity,
      score: risk.score,
      riskScore: risk.score,
      reason: risk.explanation,
      source: uri.fsPath,
      line,
      occurrences: 1,
      id,
      detectionContexts: [
        {
          filePath: uri.fsPath,
          lineNumbers: [line],
          snippet: cleanSnippet
        }
      ]
    });
    
    console.log(`[multilang-detector] ✅ Detected ${displayName} via ${detectionType} at line ${line}`);
  } catch (err) {
    console.warn(`[multilang-detector] ⚠️ Error adding detection:`, err);
  }
}
// src/parser/multilang-detector.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CryptoAsset, Severity } from "./types";
import { assignRisk } from "./risk-utils";
import { getParserForExtension } from "./ts-wasm";

const rulesPath = path.join(__dirname, "rules", "crypto-rules.json");

let CRYPTO_RULES: Record<string, any[]> = {};

// Load rules safely
try {
  if (fs.existsSync(rulesPath)) {
    CRYPTO_RULES = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    console.log(`[multilang-detector] Loaded rules for languages: ${Object.keys(CRYPTO_RULES).join(', ')}`);
  } else {
    console.warn(`[multilang-detector] Rules file not found: ${rulesPath}`);
  }
} catch (err) {
  console.error(`[multilang-detector] Failed to load rules:`, err);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect cryptographic algorithms in multi-language files using AST parsing
 */
export async function detectMultiLang(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const ext = path.extname(uri.fsPath);
  
  try {
    const parserInfo = await getParserForExtension(ext);
    
    if (!parserInfo) {
      console.log(`[multilang-detector] No parser available for ${ext}`);
      return [];
    }

    const { langKey, parser } = parserInfo;
    const langRules = CRYPTO_RULES[langKey] || [];

    if (langRules.length === 0) {
      console.log(`[multilang-detector] No rules defined for ${langKey}`);
      return [];
    }

    console.log(`[multilang-detector] Scanning ${uri.fsPath} with ${langKey} parser (${langRules.length} rules)`);

    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    
    let tree;
    try {
      tree = parser.parse(text);
    } catch (parseErr) {
      console.warn(`[multilang-detector] Parse error for ${uri.fsPath}:`, parseErr);
      return [];
    }

    const results: CryptoAsset[] = [];
    const foundIds = new Set<string>();

    // AST-based detection
    function walk(node: any): void {
      if (!node) return;

      try {
        const snippet = text.slice(node.startIndex, node.endIndex);

        for (const rule of langRules) {
          if (!rule.name) continue;

          // Check for API signatures first (more specific)
          if (rule.api) {
            const apiPattern = new RegExp(`\\b${escapeRegExp(rule.api)}\\b`, "i");
            if (apiPattern.test(snippet)) {
              addDetection(rule, node, snippet, text, uri, foundIds, results, 'api');
              continue;
            }
          }

          // Then check for algorithm names
          const pattern = new RegExp(`\\b${escapeRegExp(rule.name)}\\b`, "i");
          if (pattern.test(snippet)) {
            addDetection(rule, node, snippet, text, uri, foundIds, results, 'name');
          }
        }

        // Recursively walk child nodes
        if (node.childCount > 0) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
              walk(child);
            }
          }
        }
      } catch (err) {
        console.warn(`[multilang-detector] Error processing node:`, err);
      }
    }

    walk(tree.rootNode);

    // Regex fallback for patterns missed by AST
    for (const rule of langRules) {
      if (!rule.name && !rule.api) continue;

      const searchTerm = rule.api || rule.name;
      const re = new RegExp(`\\b${escapeRegExp(searchTerm)}\\b`, "gi");
      let match: RegExpExecArray | null;

      while ((match = re.exec(text)) !== null) {
        const index = match.index;
        const line = text.substring(0, index).split("\n").length || 1;
        const id = `text:${(rule.name || rule.api || 'unknown').toLowerCase()}-${line}`;

        if (!foundIds.has(id)) {
          foundIds.add(id);
          
          const risk = assignRisk(
            rule.quantumSafe, 
            rule.type ?? rule.primitive, 
            rule.name || rule.api
          );
          
          const snippetStart = Math.max(0, index);
          const snippetEnd = Math.min(text.length, index + 200);
          const snippet = text.substring(snippetStart, snippetEnd);

          results.push({
            name: rule.name || rule.api,
            type: rule.type ?? rule.primitive,
            primitive: rule.primitive ?? rule.type,
            assetType: "algorithm",
            description: rule.description ?? "",
            quantumSafe: rule.quantumSafe,
            severity: risk.severity as Severity,
            score: risk.score,
            riskScore: risk.score,
            reason: risk.explanation,
            source: uri.fsPath,
            line,
            occurrences: 1,
            id,
            detectionContexts: [
              {
                filePath: uri.fsPath,
                lineNumbers: [line],
                snippet
              }
            ]
          });
        }
      }
    }

    console.log(`[multilang-detector] ✅ Found ${results.length} algorithms in ${path.basename(uri.fsPath)}`);
    return results;

  } catch (err) {
    console.error(`[multilang-detector] Error processing ${uri.fsPath}:`, err);
    return [];
  }
}

/**
 * Helper function to add a detection result
 */
function addDetection(
  rule: any,
  node: any,
  snippet: string,
  text: string,
  uri: vscode.Uri,
  foundIds: Set<string>,
  results: CryptoAsset[],
  detectionType: 'api' | 'name'
): void {
  try {
    const line = text.substring(0, node.startIndex).split("\n").length || 1;
    const id = `ast:${(rule.name || rule.api || 'unknown').toLowerCase()}-${line}`;
    
    if (foundIds.has(id)) return;
    
    foundIds.add(id);
    
    const risk = assignRisk(
      rule.quantumSafe, 
      rule.type ?? rule.primitive, 
      rule.name || rule.api
    );

    const displayName = rule.name || rule.api;
    const cleanSnippet = snippet.substring(0, 300).replace(/\s+/g, ' ').trim();

    results.push({
      name: displayName,
      type: rule.type ?? rule.primitive,
      primitive: rule.primitive ?? rule.type,
      assetType: "algorithm",
      description: rule.description ?? `${detectionType === 'api' ? 'API call' : 'Algorithm'} detected`,
      quantumSafe: rule.quantumSafe,
      severity: risk.severity as Severity,
      score: risk.score,
      riskScore: risk.score,
      reason: risk.explanation,
      source: uri.fsPath,
      line,
      occurrences: 1,
      id,
      detectionContexts: [
        {
          filePath: uri.fsPath,
          lineNumbers: [line],
          snippet: cleanSnippet
        }
      ]
    });
  } catch (err) {
    console.warn(`[multilang-detector] Error adding detection:`, err);
  }
}