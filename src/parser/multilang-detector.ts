// src/parser/multilang-detector.ts - language-aware AST detection
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

function getCallTarget(node: any, text: string): string {
  let argumentNode: any;
  for (let i = 0; i < (node.childCount ?? 0); i++) {
    const child = node.child(i);
    if (/^(arguments|argument_list|arguments_list|value_arguments)$/.test((child?.type ?? '').toLowerCase())) {
      argumentNode = child;
      break;
    }
  }
  const endIndex = argumentNode?.startIndex ?? node.endIndex;
  return text.slice(node.startIndex, endIndex).trim();
}

function hasCryptoContext(context: string): boolean {
  return /\b(crypto|hash|digest|cipher|mac|hmac|encrypt|decrypt|sign|verify|keypair|keygen|getinstance|curve|sha\d*|md5|aes|des|chacha)\b|\bevp_[a-z0-9_]*|\brsa_[a-z0-9_]*|\becdsa\b/i.test(context);
}

function isValidCryptoNode(node: any, text: string): boolean {
  if (!node) return false;

  const nodeType = (node.type || "").toLowerCase();
  if (!nodeType) return false;

  if (nodeType.includes("comment")) {
    return false;
  }

  // A match in an import, variable, declaration, or string is only a mention.
  // Require a syntax node that represents an invoked function/method so evidence
  // points to an actual call site. Language-specific APIs can extend this list.
  const callNodeTypes = new Set([
    'call_expression', // JavaScript, C, C++
    'method_invocation', // Java
    'call', // Python and Ruby
    'function_call_expression', // PHP
    'member_call_expression', // PHP
    'scoped_call_expression' // PHP
  ]);
  if (!callNodeTypes.has(nodeType)) return false;

  return hasCryptoContext(getCallTarget(node, text));
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

function getRuleConfidence(node: any, text: string, rule: any): 'high' | 'medium' | 'low' {
  const snippet = text.slice(node.startIndex, node.endIndex);
  if (!matchesRuleSignature(snippet, rule)) return 'low';

  const target = getCallTarget(node, text).replace(/\s+/g, '').toLowerCase();
  const apiTarget = typeof rule?.api === 'string'
    ? rule.api.split('(')[0].replace(/\s+/g, '').toLowerCase()
    : '';
  if (apiTarget && target === apiTarget) return 'high';
  return hasCryptoContext(target) ? 'medium' : 'low';
}

export async function detectMultiLang(text: string, filename: string, preferredLangKey?: WasmLang): Promise<CryptoAsset[]> {
  try {
    const ext = path.extname(filename);
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
    const langRules = CRYPTO_RULES[langKey]
      || (langKey === 'typescript' || langKey === 'tsx' ? CRYPTO_RULES.javascript : undefined)
      || (langKey === 'kotlin' ? CRYPTO_RULES.java : undefined)
      || [];
    if (!Array.isArray(langRules) || langRules.length === 0) {
      return [];
    }

    console.log(`[MULTILANG] AST scanning with ${langKey} parser`);

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
          const confidence = getRuleConfidence(node, text, rule);
          if (confidence === 'low') continue;

          const lineStart = text.lastIndexOf('\n', node.startIndex - 1) + 1;
          const line = text.substring(0, lineStart).split("\n").length || 1;
          const column = node.startIndex - lineStart;
          const detectionKey = `${rule.name}:${path.resolve(filename)}:${node.startIndex}`;

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
            reason: risk.explanation,
            classicalSecurityStatus: risk.classicalSecurityStatus,
            quantumImpact: risk.quantumImpact,
            detectionMethod: 'syntax-call',
            confidence,
            source: filename,
            line,
            column,
            startOffset: node.startIndex,
            endOffset: node.endIndex,
            occurrences: 1,
            id: `ast:${encodeURIComponent(path.resolve(filename))}:${(rule.name || "unknown").toLowerCase()}:${node.startIndex}`,
            detectionContexts: [
              {
                filePath: filename,
                lineNumbers: [line],
                snippet: snippet.substring(0, 300),
                startOffset: node.startIndex,
                endOffset: node.endIndex
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
