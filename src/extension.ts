import * as vscode from 'vscode';

// --- Database of cryptographic algorithms and metadata ---
const algorithms: Record<string, any> = {
  SHA1: {
    regex: /\bsha1\b/gi,
    description: 'SHA-1 is an old hash function vulnerable to collision attacks.',
    type: 'Hash Function',
    keySize: '160-bit',
    securityLevel: 'Weak',
    quantumSafe: '❌ Not quantum-safe (Grover’s algorithm)',
  },
  SHA256: {
    regex: /\bsha-?256\b/gi,
    description: 'SHA-256 — Part of the SHA-2 family, used for secure hashing.',
    type: 'Hash Function',
    keySize: '256-bit',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe (Grover’s algorithm halves strength)',
  },
  SHA512: {
    regex: /\bsha-?512\b/gi,
    description: 'SHA-512 — Strong 512-bit hash function.',
    type: 'Hash Function',
    keySize: '512-bit',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe (Grover’s algorithm halves strength)',
  },
  MD5: {
    regex: /\bmd5\b/gi,
    description: 'MD5 — Obsolete hash function with collision vulnerabilities.',
    type: 'Hash Function',
    keySize: '128-bit',
    securityLevel: 'Broken',
    quantumSafe: '❌ Not quantum-safe',
  },
  AES: {
    regex: /\baes\b/gi,
    description: 'AES — Symmetric cipher used for encryption.',
    type: 'Symmetric Cipher',
    keySize: '128 / 192 / 256-bit',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe (Grover’s algorithm halves key strength)',
  },
  RSA: {
    regex: /\brsa\b/gi,
    description: 'RSA — Asymmetric algorithm for encryption/signing.',
    type: 'Asymmetric Cipher',
    keySize: '2048–4096-bit',
    securityLevel: 'Medium',
    quantumSafe: '❌ Not quantum-safe (Shor’s algorithm breaks RSA)',
  },
  DSA: {
    regex: /\bdsa\b/gi,
    description: 'DSA — Digital Signature Algorithm for signing.',
    type: 'Asymmetric Cipher',
    keySize: '1024–3072-bit',
    securityLevel: 'Medium',
    quantumSafe: '❌ Not quantum-safe (Shor’s algorithm breaks DSA)',
  },
  ECDSA: {
    regex: /\becdsa\b/gi,
    description: 'ECDSA — Elliptic Curve Digital Signature Algorithm.',
    type: 'Asymmetric Cipher',
    keySize: '256–521-bit curves',
    securityLevel: 'High',
    quantumSafe: '❌ Not quantum-safe (Shor’s algorithm breaks ECC)',
  },
  Kyber: {
    regex: /\bkyber\b/gi,
    description: 'Kyber — Post-quantum key encapsulation algorithm.',
    type: 'Post-Quantum Cipher',
    keySize: 'Variable',
    securityLevel: 'Very High',
    quantumSafe: '✅ Quantum-safe (NIST PQC finalist)',
  },
  Dilithium: {
    regex: /\bdilithium\b/gi,
    description: 'Dilithium — Post-quantum digital signature algorithm.',
    type: 'Post-Quantum Signature',
    keySize: 'Variable',
    securityLevel: 'Very High',
    quantumSafe: '✅ Quantum-safe (NIST PQC finalist)',
  },
};

export function activate(context: vscode.ExtensionContext) {
  console.log('Crypto Detector Extension Activated');

  const diagnosticCollection = vscode.languages.createDiagnosticCollection('crypto-detector');
  context.subscriptions.push(diagnosticCollection);

  let disposable = vscode.commands.registerCommand('crypto-detector.detectCrypto', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a file to analyze first!');
      return;
    }

    const text = editor.document.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    const results: any[] = [];

    for (const [name, info] of Object.entries(algorithms)) {
      const matches = [...text.matchAll(info.regex)];
      if (matches.length > 0) {
        const lines = new Set<number>();

        matches.forEach((match) => {
          const pos = editor.document.positionAt(match.index || 0);
          lines.add(pos.line + 1);

          // Color based on quantum safety
          const severity =
            info.quantumSafe.includes('✅')
              ? vscode.DiagnosticSeverity.Hint
              : info.quantumSafe.includes('⚠️')
              ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Error;

          const diagnostic = new vscode.Diagnostic(
            new vscode.Range(pos, pos.translate(0, name.length)),
            `${name} detected — ${info.quantumSafe}`,
            severity
          );
          diagnosticCollection.set(editor.document.uri, [...diagnostics, diagnostic]);
          diagnostics.push(diagnostic);
        });

        results.push({
          name,
          occurrences: matches.length,
          lines: [...lines],
          ...info,
        });
      }
    }

    // --- Print formatted report ---
    const output = vscode.window.createOutputChannel('Crypto Detector');
    output.clear();
    output.appendLine('🔍 CRYPTOGRAPHIC ALGORITHM ANALYSIS REPORT');
    output.appendLine('──────────────────────────────────────────────');
    for (const res of results) {
      output.appendLine(`🧩 Algorithm: ${res.name}`);
      output.appendLine(`   • Type: ${res.type}`);
      output.appendLine(`   • Key Size: ${res.keySize}`);
      output.appendLine(`   • Lines: ${res.lines.join(', ')}`);
      output.appendLine(`   • Occurrences: ${res.occurrences}`);
      output.appendLine(`   • Quantum-Safe: ${res.quantumSafe}`);
      output.appendLine(`   • Description: ${res.description}`);
      output.appendLine('──────────────────────────────────────────────');
    }
    if (results.length === 0) {
      output.appendLine('✅ No known cryptographic algorithms found.');
    }
    output.show(true);
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
