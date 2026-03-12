// src/parser/multilang-detector.ts - language-aware AST detection
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
    console.log("[MULTILANG] ✅ Loaded crypto-rules.json");
  }
} catch (err) {
  console.error("[MULTILANG] ❌ Failed to load crypto-rules.json:", err);
}

function escapeRegExp(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSignature(input: string): string {
  return (input || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function patternToRegex(pattern: string): RegExp | null {
  if (!pattern || typeof pattern !== "string") return null;

  const trimmed = pattern.trim();
  if (!trimmed) return null;

  // Allow wildcard-style signatures from rules (e.g. Cipher.*AES, KeyPairGenerator.*RSA)
  const wildcardEscaped = trimmed
    .split("*")
    .map((part) => escapeRegExp(part))
    .join(".*");

  // Word boundaries only for simple identifiers.
  const source = /^\w+$/.test(trimmed) ? `\\b${wildcardEscaped}\\b` : wildcardEscaped;
  return new RegExp(source, "i");
}

function getNodeContext(node: any, text: string): string {
  const start = Math.max(0, node.startIndex - 120);
  const end = Math.min(text.length, node.endIndex + 120);
  return text.slice(start, end);
}

function hasCryptoContext(context: string): boolean {
  return /\b(crypto|hash|digest|cipher|mac|hmac|encrypt|decrypt|sign|verify|keypair|keygen|getinstance|evp_|rsa_|ecdsa|curve|sha\d*|md5|aes|des|chacha)\b/i.test(context);
}

function isValidCryptoNode(node: any, text: string): boolean {
  if (!node) return false;

  const nodeType = (node.type || "").toLowerCase();
  if (!nodeType) return false;

  if (nodeType.includes("comment")) {
    return false;
  }

  const context = getNodeContext(node, text);

  const validTypeHints = [
    "call_expression",
    "method_invocation",
    "function_call",
    "call",
    "assignment",
    "variable_declarator",
    "declaration",
    "argument_list",
    "field_expression",
    "member_expression",
    "string"
  ];

  const hasValidTypeHint = validTypeHints.some((hint) => nodeType.includes(hint));
  if (!hasValidTypeHint) {
    return false;
  }

  if (nodeType.includes("string")) {
    return hasCryptoContext(context);
  }

  return true;
}

function ruleCandidates(rule: any): string[] {
  const out = new Set<string>();
  if (rule?.name) out.add(rule.name);
  if (rule?.api) out.add(rule.api);
  if (Array.isArray(rule?.patterns)) {
    for (const p of rule.patterns) {
      if (typeof p === "string" && p.trim()) out.add(p.trim());
    }
  }
  return Array.from(out);
}

function matchesRuleSignature(snippet: string, rule: any): boolean {
  const candidates = ruleCandidates(rule);
  if (candidates.length === 0) return false;

  const normalizedSnippet = normalizeSignature(snippet);

  for (const candidate of candidates) {
    const regex = patternToRegex(candidate);
    if (regex && regex.test(snippet)) {
      return true;
    }

    // Normalized fallback: helps detect variants like SHA-256 vs SHA256.
    const normalizedCandidate = normalizeSignature(candidate);
    if (normalizedCandidate && normalizedSnippet.includes(normalizedCandidate)) {
      return true;
    }
  }

  return false;
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
      return [];
    }

    const { langKey, parser } = parserInfo;
    const langRules = CRYPTO_RULES[langKey] || [];
    if (!Array.isArray(langRules) || langRules.length === 0) {
      return [];
    }

    console.log(`[MULTILANG] AST scanning with ${langKey} parser`);

    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    if (!text) return [];

    const tree = parser.parse(text);
    const results: CryptoAsset[] = [];
    const seenDetections = new Set<string>();

    function walk(node: any) {
      if (!node) return;

      try {
        const snippet = text.slice(node.startIndex, node.endIndex);
        if (!snippet || snippet.length > 1200) {
          if (node.childCount) {
            for (let i = 0; i < node.childCount; i++) walk(node.child(i));
          }
          return;
        }

        if (!isValidCryptoNode(node, text)) {
          if (node.childCount) {
            for (let i = 0; i < node.childCount; i++) walk(node.child(i));
          }
          return;
        }

        for (const rule of langRules) {
          if (!rule?.name) continue;

          if (!matchesRuleSignature(snippet, rule)) {
            continue;
          }

          const line = text.substring(0, node.startIndex).split("\n").length || 1;
          const snippetHash = snippet.trim().substring(0, 120).replace(/\s+/g, " ");
          const detectionKey = `${rule.name}:${path.basename(uri.fsPath)}:${line}:${snippetHash}`;

          if (seenDetections.has(detectionKey)) continue;
          seenDetections.add(detectionKey);

          const risk = assignRisk(rule.quantumSafe, rule.type ?? rule.primitive, rule.name);

          results.push({
            name: rule.name,
            type: rule.type ?? rule.primitive ?? "unknown",
            primitive: rule.primitive ?? rule.type ?? "unknown",
            assetType: "algorithm",
            description: rule.description ?? "",
            quantumSafe: rule.quantumSafe ?? "unknown",
            severity: risk.severity as Severity,
            score: risk.score,
            riskScore: risk.score,
            reason: risk.explanation,
            source: uri.fsPath,
            line,
            occurrences: 1,
            id: `ast:${(rule.name || "unknown").toLowerCase()}-${path.basename(uri.fsPath)}-${line}`,
            detectionContexts: [
              {
                filePath: uri.fsPath,
                lineNumbers: [line],
                snippet: snippet.substring(0, 300)
              }
            ]
          });
        }

        if (node.childCount) {
          for (let i = 0; i < node.childCount; i++) walk(node.child(i));
        }
      } catch (err) {
        // Continue walking
      }
    }

    walk(tree.rootNode);

    console.log(`[MULTILANG] ✅ AST found ${results.length} detections`);
    return results;
  } catch (err) {
    console.error("[MULTILANG] detectMultiLang error:", err);
    return [];
  }
}
