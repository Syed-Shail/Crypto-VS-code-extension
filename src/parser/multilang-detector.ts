// src/parser/multilang-detector.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CryptoAsset, Severity } from "./types";
import { assignRisk } from "./risk-utils";
import { getParserForExtension } from "./ts-wasm";

const rulesPath = path.join(__dirname, "rules", "crypto-rules.json");
const CRYPTO_RULES = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function detectMultiLang(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const ext = path.extname(uri.fsPath);
  const parserInfo = await getParserForExtension(ext).catch(() => null);

  if (!parserInfo) return [];

  const { langKey, parser } = parserInfo;
  const langRules = CRYPTO_RULES[langKey] || [];

  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  const tree = parser.parse(text);

  const results: CryptoAsset[] = [];

  function walk(node: any) {
    const snippet = text.slice(node.startIndex, node.endIndex);

    for (const rule of langRules) {
      const pattern = new RegExp(`\\b${escapeRegExp(rule.name)}\\b`, "i");

      if (pattern.test(snippet)) {
        const line = text.substring(0, node.startIndex).split("\n").length || 1;
        const risk = assignRisk(rule.quantumSafe, rule.type ?? rule.primitive, rule.name);

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
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);

  // Text fallback (missed AST nodes)
  for (const rule of langRules) {
    const re = new RegExp(`\\b${escapeRegExp(rule.name)}\\b`, "gi");
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      const index = match.index;
      const line = text.substring(0, index).split("\n").length || 1;
      const risk = assignRisk(rule.quantumSafe, rule.type ?? rule.primitive, rule.name);
      const snippet = text.substr(index, 200);

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
  }

  return results;
}
