# Crypto Detector for VS Code

Crypto Detector helps developers and security teams discover cryptographic algorithm use in source code, review the evidence, and plan classical security or post-quantum migration work. It runs locally; a remote repository is cloned only when you explicitly start a GitHub scan.

> **Assessment limits:** a detected algorithm name does not prove that an API is used correctly, that its parameters are safe, or that a system is secure. Results are code-discovery evidence and should be reviewed in context.

## Current capabilities

- Scan the active file or the open workspace from the VS Code Command Palette.
- Scan a public GitHub repository by URL.
- Report findings in the VS Code Problems panel and apply source highlights.
- Export a CycloneDX 1.7 CBOM with algorithm inventory, source locations, and Crypto Detector assessment metadata.
- Use the same source-analysis pipeline in the extension and CLI.
- Use Tree-sitter syntax call-site matching for JavaScript/TypeScript, Python, Java/Kotlin, C/C++, Go, Rust, PHP, and Ruby; text-rule candidates are retained at low confidence when no language-specific call-site rule confirms a match.

## Scan commands

Open the Command Palette (`Cmd+Shift+P` on macOS) and run:

- **Crypto Detector: Scan Current File**
- **Crypto Detector: Scan Entire Workspace**
- **Crypto Detector: Scan GitHub Repository**
- **Crypto Detector: Export CBOM**
- **Crypto Detector: Show Dashboard**

The Problems panel distinguishes lower-confidence text candidates from parser-backed call-site matches. Severity describes known classical algorithm status; quantum impact is shown separately as a migration signal.

## Development setup

Requirements: Node.js and npm. From the extension directory:

```bash
npm ci
npm run setup
```

Open this folder in VS Code and press **F5** to launch the Extension Development Host. `npm run setup` copies any missing grammar files and compiles the project; existing grammar files are preserved unless the copy script is run with its explicit `--force` option.

## CLI

After compiling, invoke the built CLI with Node:

```bash
node out/cli.js --help
node out/cli.js scan-file path/to/source.ts --no-browser
node out/cli.js scan-workspace path/to/repository --no-browser
node out/cli.js export-cbom path/to/repository --output ./crypto-analysis/bom.json
```

The CLI and extension share the same syntax and text analysis pipeline. GitHub scans require network access and `git` on `PATH`.

Repeat scans reuse results for unchanged files (see below); pass `--no-cache` to re-analyse everything.

## Performance

Folder scans walk the directory tree asynchronously, read files concurrently, and keep a persistent per-file result cache (`src/core/scan-cache.ts`). An unchanged file is reused without being read when its size and modification time match. A file whose timestamp changed but whose content didn't (after a branch switch, say) is matched by SHA-256 content hash and also reused. The cache is keyed by the extension version and the detection rules, so changing a rule invalidates it automatically. The CLI stores it in `~/.cache/crypto-detector/`, the extension in its VS Code global storage. Files with unsaved editor changes always bypass it.

Benchmark on three open-source codebases (median of 3 runs, Apple M5, Node 26). Reproduce with `npm run benchmark -- <repo> ...`; raw output is in [`benchmark/results.json`](benchmark/results.json).

| Repository | Files | Lines | Full scan | Throughput | Re-scan, nothing changed | Re-scan after editing 5% of files |
|---|---|---|---|---|---|---|
| [paramiko](https://github.com/paramiko/paramiko) (Python) | 70 | 27,672 | 0.35 s | 80,000 lines/s | 0.002 s (**99.5% faster**) | 0.014 s (**96.0% faster**) |
| [jjwt](https://github.com/jwtk/jjwt) (Java) | 407 | 44,563 | 0.38 s | 118,000 lines/s | 0.006 s (**98.3% faster**) | 0.021 s (**94.5% faster**) |
| [Mbed TLS](https://github.com/Mbed-TLS/mbedtls) (C) | 150 | 92,088 | 0.77 s | 120,000 lines/s | 0.003 s (**99.7% faster**) | 0.042 s (**94.5% faster**) |

In every run the cached scans returned exactly the same findings as an uncached scan. Concurrent reading does not shorten a first scan noticeably, because analysis is CPU-bound on one thread; the savings come from not re-analysing unchanged files.

## Tests

```bash
npm run compile
npm run test:unit   # cache correctness, invalidation, exclusions (Node test runner, no VS Code needed)
npm test            # extension integration tests (downloads VS Code)
```

## Output and privacy

- CBOM files use CycloneDX 1.7. Tool-specific status fields are stored as CycloneDX properties rather than non-standard fields inside `cryptoProperties`.
- Exported source locations are relative to the scanned root where available. Source snippets are not included in CBOM exports.
- Local workspace scans do not upload source. The optional GitHub scan downloads a repository into a temporary directory to analyze it.
- Generated dashboards are local files. The primary scan dashboard does not load charting code from a CDN.

## Known limitations

- This release is an early product foundation, not a complete cryptographic inventory or formal security assessment.
- Detection coverage is rule-based and currently strongest for common algorithm/API call sites in JavaScript/TypeScript, Python, Java/Kotlin, C/C++, and Go. Rust, PHP, and Ruby rules cover a narrower set of common APIs. Text candidates can be false positives and may miss indirection, wrappers, reflection, generated code, or runtime-selected algorithms.
- The current inventory focuses on source-code algorithm calls. Dependency manifests, certificates, key material, protocol configuration, binary analysis, data-flow, and runtime behavior are not yet comprehensively analyzed.
- Quantum impact is a migration planning classification, not a claim that quantum attacks are currently practical. Algorithm status does not assess mode, key size, nonce handling, entropy, library version, or implementation quality.
- CBOM output is structured for CycloneDX 1.7; formal schema validation and broader interoperability checks remain part of the product refresh.

## Product refresh

See [PRODUCT-REFRESH.md](PRODUCT-REFRESH.md) for the product principles, architecture direction, delivery sequence, and acceptance bar.

## Maintainer

Syed Shail · [GitHub repository](https://github.com/Syed-Shail/Crypto-VS-code-extension)

## License

MIT
