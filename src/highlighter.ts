// src/highlighter.ts
import * as vscode from 'vscode';
import { CryptoAsset } from './parser/types';

/**
 * Highlighter: maintain decorations and hover info per open editor.
 *
 * Strategy:
 * - Keep a cache Map<filePath, CryptoAsset[]>
 * - For each open editor, look up assets for that file and create DecorationOptions
 *   by finding the asset.name in the line(s) where the detection happened.
 * - Register a HoverProvider to show a compact info card for hovered detections.
 */

/* ----------------------------- Decoration styles ---------------------------- */
const highDecoration = vscode.window.createTextEditorDecorationType({
  border: '1px solid rgba(255,80,80,0.8)',
  overviewRulerColor: 'red',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
  light: { backgroundColor: 'rgba(255,80,80,0.08)' },
  dark: { backgroundColor: 'rgba(255,80,80,0.08)' },
});

const mediumDecoration = vscode.window.createTextEditorDecorationType({
  border: '1px solid rgba(255,165,0,0.9)',
  overviewRulerColor: 'orange',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
  light: { backgroundColor: 'rgba(255,165,0,0.06)' },
  dark: { backgroundColor: 'rgba(255,165,0,0.06)' },
});

const lowDecoration = vscode.window.createTextEditorDecorationType({
  border: '1px solid rgba(80,200,120,0.8)',
  overviewRulerColor: 'green',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
  light: { backgroundColor: 'rgba(80,200,120,0.06)' },
  dark: { backgroundColor: 'rgba(80,200,120,0.06)' },
});

const unknownDecoration = vscode.window.createTextEditorDecorationType({
  border: '1px solid rgba(180,180,180,0.6)',
  overviewRulerColor: 'gray',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
  light: { backgroundColor: 'rgba(200,200,200,0.03)' },
  dark: { backgroundColor: 'rgba(200,200,200,0.03)' },
});

/* ----------------------------- Internal cache ------------------------------ */
const fileAssetCache: Map<string, CryptoAsset[]> = new Map();

/* ----------------------------- Helpers ------------------------------------- */
function getDecorationForSeverity(sev?: 'low' | 'medium' | 'high' | string) {
  if (sev === 'high') return highDecoration;
  if (sev === 'medium') return mediumDecoration;
  if (sev === 'low') return lowDecoration;
  return unknownDecoration;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ----------------------------- Apply Highlights ---------------------------- */

/**
 * updateHighlightsForEditor
 * Determine ranges in the editor that correspond to asset names and apply decorations.
 */
async function updateHighlightsForEditor(editor: vscode.TextEditor, assets: CryptoAsset[]) {
  if (!editor || !assets || assets.length === 0) {
    // clear all decorations
    editor.setDecorations(highDecoration, []);
    editor.setDecorations(mediumDecoration, []);
    editor.setDecorations(lowDecoration, []);
    editor.setDecorations(unknownDecoration, []);
    return;
  }

  const text = editor.document.getText();
  const highRanges: vscode.DecorationOptions[] = [];
  const medRanges: vscode.DecorationOptions[] = [];
  const lowRanges: vscode.DecorationOptions[] = [];
  const unknownRanges: vscode.DecorationOptions[] = [];

  // Build map of lines -> text for fast access
  const lineCount = editor.document.lineCount;

  // For each asset, attempt to place decorations on the line numbers reported
  for (const asset of assets) {
    const name = asset.name ?? '';
    if (!name) continue;

    const lookups = asset.detectionContexts?.flatMap(ctx => ctx.lineNumbers ?? []) ?? [];
    const uniqueLines = Array.from(new Set(lookups));

    for (const ln of uniqueLines) {
      const lineIndex = Math.max(0, Math.min(lineCount - 1, ln - 1));
      const lineText = editor.document.lineAt(lineIndex).text;
      const re = new RegExp(escapeRegex(name), 'i');
      const match = re.exec(lineText);
      if (!match) {
        // fallback: try to find any token that looks like the asset name (split words)
        const tokens = (name).split(/[\s@:_-]+/).filter(Boolean);
        let found = false;
        for (const t of tokens) {
          const r2 = new RegExp(escapeRegex(t), 'i');
          const m2 = r2.exec(lineText);
          if (m2) {
            const start = m2.index;
            const range = new vscode.Range(lineIndex, start, lineIndex, start + m2[0].length);
            const deco = createDecorationOptionsForAsset(asset, range);
            pushDecorationBySeverity(asset.severity, deco, highRanges, medRanges, lowRanges, unknownRanges);
            found = true;
            break;
          }
        }
        if (found) continue;
        // else skip this line
        continue;
      }

      const start = match.index;
      const end = match.index + (match[0]?.length ?? name.length);
      const range = new vscode.Range(lineIndex, start, lineIndex, end);
      const deco = createDecorationOptionsForAsset(asset, range);
      pushDecorationBySeverity(asset.severity, deco, highRanges, medRanges, lowRanges, unknownRanges);
    }
  }

  editor.setDecorations(highDecoration, highRanges);
  editor.setDecorations(mediumDecoration, medRanges);
  editor.setDecorations(lowDecoration, lowRanges);
  editor.setDecorations(unknownDecoration, unknownRanges);
}

function createDecorationOptionsForAsset(asset: CryptoAsset, range: vscode.Range): vscode.DecorationOptions {
  const tooltip = makeTooltipForAsset(asset);
  return { range, hoverMessage: tooltip };
}

function pushDecorationBySeverity(
  sev: string | undefined,
  deco: vscode.DecorationOptions,
  highRanges: vscode.DecorationOptions[],
  medRanges: vscode.DecorationOptions[],
  lowRanges: vscode.DecorationOptions[],
  unknownRanges: vscode.DecorationOptions[]
) {
  if (sev === 'high') highRanges.push(deco);
  else if (sev === 'medium') medRanges.push(deco);
  else if (sev === 'low') lowRanges.push(deco);
  else unknownRanges.push(deco);
}

function makeTooltipForAsset(a: CryptoAsset): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendCodeblock(`${a.name}`, 'text');
  const severity = (a.severity ?? 'unknown').toUpperCase();
  const score = a.riskScore ?? a.score ?? 0;
  md.appendMarkdown(`**Severity:** ${severity} · **Risk Score:** ${score}\n\n`);
  md.appendMarkdown(`**Quantum-safe:** \`${String(a.quantumSafe)}\`\n\n`);
  if (a.description) md.appendMarkdown(`**Note:** ${a.description}\n\n`);
  md.appendMarkdown(`**Occurrences:** ${a.occurrences ?? 1}\n\n`);
  md.isTrusted = true;
  return md;
}

/* ----------------------------- Hover Provider ------------------------------ */

// We register a hover provider but use our cache to produce hover content
const hoverProvider: vscode.HoverProvider = {
  provideHover(document, position) {
    const filePath = document.uri.fsPath;
    const assets = fileAssetCache.get(filePath) || [];
    // find any asset that includes this line and contains name in the line
    const line = document.lineAt(position.line).text;
    // search assets with lineNumbers includes current line+1 and name present
    for (const a of assets) {
      const lines = a.detectionContexts?.flatMap(c => c.lineNumbers ?? []) ?? [];
      if (lines.includes(position.line + 1)) {
        const re = new RegExp(escapeRegex(a.name ?? ''), 'i');
        if (re.test(line)) {
          return new vscode.Hover(makeTooltipForAsset(a));
        }
        // also check tokens
        const tokens = (a.name ?? '').split(/[\s@:_-]+/).filter(Boolean);
        for (const t of tokens) {
          if (t.length >= 3 && line.toLowerCase().includes(t.toLowerCase())) {
            return new vscode.Hover(makeTooltipForAsset(a));
          }
        }
      }
    }
    return null;
  }
};

/* ----------------------------- Public API --------------------------------- */

/**
 * Register providers and listeners, returns disposable to add to extension context.
 */
export function registerHighlighter(context: vscode.ExtensionContext): vscode.Disposable {
  // register hover provider for all languages
  const sub = vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider);
  context.subscriptions.push(sub);

  // Re-apply highlights when editors change or when active editor switches
  const disp1 = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) return;
    const assets = fileAssetCache.get(editor.document.uri.fsPath) ?? [];
    updateHighlightsForEditor(editor, assets).catch(() => {});
  });
  const disp2 = vscode.workspace.onDidChangeTextDocument((e) => {
    // re-highlight if file in cache
    const assets = fileAssetCache.get(e.document.uri.fsPath);
    if (assets && vscode.window.activeTextEditor?.document.uri.fsPath === e.document.uri.fsPath) {
      updateHighlightsForEditor(vscode.window.activeTextEditor, assets).catch(() => {});
    }
  });

  context.subscriptions.push(disp1, disp2);
  return {
    dispose: () => {
      sub.dispose();
      disp1.dispose();
      disp2.dispose();
      clearAllDecorations();
    }
  };
}

/**
 * Apply highlights for a list of assets (workspace or single-file results).
 * This populates the internal cache and updates any open editors for matching files.
 */
export async function applyHighlights(assets: CryptoAsset[]) {
  // group by file
  fileAssetCache.clear();
  for (const a of assets) {
    for (const ctx of a.detectionContexts ?? []) {
      if (!ctx.filePath) continue;               // <- guard undefined
      const fp = ctx.filePath;
      const arr = fileAssetCache.get(fp) ?? [];
      // avoid duplicates by id
      if (!arr.find(x => x.id === a.id)) arr.push(a);
      fileAssetCache.set(fp, arr);
    }
  }

  // update all open editors
  for (const editor of vscode.window.visibleTextEditors) {
    const fp = editor.document.uri.fsPath;
    const assetsForFile = fileAssetCache.get(fp) ?? [];
    await updateHighlightsForEditor(editor, assetsForFile);
  }
}

/**
 * Clear everything (cache + decorations)
 */
export function clearHighlights() {
  fileAssetCache.clear();
  clearAllDecorations();
}

function clearAllDecorations() {
  for (const editor of vscode.window.visibleTextEditors) {
    editor.setDecorations(highDecoration, []);
    editor.setDecorations(mediumDecoration, []);
    editor.setDecorations(lowDecoration, []);
    editor.setDecorations(unknownDecoration, []);
  }
}
