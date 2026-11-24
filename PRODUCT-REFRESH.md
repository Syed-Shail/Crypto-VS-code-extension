# Crypto Detector product refresh

## Product intent

Make Crypto Detector a trustworthy cryptographic discovery and migration-planning tool for both developers working in an editor and security teams reviewing repositories. A scan must show what source evidence supports each finding, how the algorithm was identified, and what the tool cannot conclude. The product must not present algorithm recognition as proof of secure or insecure implementation.

## Product rules

- Keep scanning local and offline by default. A repository URL scan is an explicit user action.
- Separate cryptographic inventory from security findings. Recognizing AES is inventory; recognizing MD5 use is a weakness finding; recognizing RSA is a quantum migration signal.
- Keep classical security status, quantum impact, configuration concerns, and detection confidence as separate fields.
- Every result must have stable file/line evidence and a stated detection method. Uncertain matches must be visibly lower confidence.
- Prefer parser-backed call-site and configuration analysis. A text match alone is a candidate, not a confirmed use.
- Export valid CycloneDX CBOM with only standard fields inside `cryptoProperties`; tool-specific assessment metadata belongs in CycloneDX `properties`.
- Keep the editor, repository scan, CLI, and export paths on the same scanner and result schema.

## Audit findings and current foundation work

The current release has several scanners and report writers with overlapping behavior. The Tree-sitter path matches rule strings against many node types instead of interpreting call sites. Regex rules can miss multiline/comment/string context and use generic names that match ordinary identifiers. Workspace deduplication depends on detector IDs that include basenames, which can merge same-named files. Risk score and severity are inferred from quantum status, which conflates a future migration concern with a known classical weakness. The two CBOM writers emitted non-standard fields inside `cryptoProperties`, put free-form descriptions in the `cryptoFunctions` enum, and declared CycloneDX 1.6 despite not following its schema.

Foundation changes delivered in 3.1.0: make the two CBOM export paths share a CycloneDX 1.7 builder; keep tool-specific fields in `properties`; represent source locations as individual CycloneDX occurrence records; separate classical status from quantum impact; and stop labeling all quantum-vulnerable algorithms as immediate high severity.

## Delivery sequence

### 1. Trustworthy findings model

- Replace the overloaded `CryptoAsset` shape with versioned inventory items and findings, preserving a compatibility adapter for existing dashboards.
- Store canonical algorithm/variant, primitive, operation when known, evidence locations, detection method, confidence, classical status, quantum impact, and limitations independently.
- Replace numeric risk guesses with explainable severity rules tied to a catalog and explicit use context.
- Ensure uncertain or unsupported syntax becomes a candidate with an uncertainty label instead of a confident finding.

### 2. Unified analysis engine

- Put file discovery, exclusions, language mapping, parser initialization, cancellation, and deduplication in one engine used by the extension, CLI, and GitHub scans.
- Use language parsers to identify relevant API calls, imports, configuration values, and dependency declarations. Extract literal algorithm names from call arguments, not from arbitrary nearby text.
- Keep a conservative, explainable fallback for unsupported syntax and languages.
- Expand language and configuration coverage based on maintained parsers and real API catalogs, not a growing list of unscoped keywords.

### 3. Developer workflow

- Show findings in the VS Code Problems panel with source ranges, categories, confidence, and direct navigation.
- Add a Crypto Inventory view with search, grouping, filters, scan status, exclusions, and an explicit rescan action.
- Keep the current-file flow fast; add workspace progress/cancellation and visible skipped/unsupported file counts.
- Add per-finding explanation and suppression with a reason, scoped to the workspace.

### 4. Security-team workflow

- Support repository scans with explicit scope, safe temp cleanup, cancellation, deterministic summaries, and optional baseline/diff comparison.
- Add machine-readable SARIF findings alongside CycloneDX inventory exports.
- Validate CBOM output against the selected CycloneDX schema and provide a clear validation result.
- Keep reports self-contained and usable offline; do not load Chart.js from a CDN or open temporary HTML in an external browser as the main experience.

### 5. Product quality and release readiness

- Add fixture coverage for positive and negative examples per supported language, API, and syntax form.
- Track precision and recall by rule set; do not expand a rule without negative examples.
- Add schema validation for CBOM and contract checks for CLI and VS Code outputs.
- Document supported languages, what is detected, known limits, privacy behavior, release process, and versioned output formats.

## Acceptance bar

A finding is not considered production-ready unless it has a stable identity, file and line evidence, a detection explanation, and a confidence level. A scan summary must distinguish confirmed findings, lower-confidence candidates, unsupported files, and files skipped by policy. A report must be reproducible for the same source revision and configuration, except for its unique BOM serial number and timestamp.
