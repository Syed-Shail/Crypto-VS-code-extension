# Change Log

All notable changes to the "crypto-detector" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [3.1.0]

- Folder and workspace scans keep a persistent per-file result cache keyed by file metadata, content hash and the detection rules; re-scans of unchanged repositories are 98–99.7% faster and incremental re-scans 94–96% faster on the benchmark repositories, with identical findings.
- Directory walking and file reads are asynchronous and concurrent; per-file logging is opt-in via `CRYPTO_DETECTOR_VERBOSE=1`.
- New `--no-cache` CLI option, `npm run benchmark` and `npm run test:unit`.
- One analysis pipeline shared by the extension, CLI and GitHub scans; Tree-sitter call-site detection extended to Kotlin, Go, Rust, PHP and Ruby alongside JavaScript/TypeScript, Python, Java and C/C++.
- CycloneDX 1.7 CBOM export with standard `cryptoProperties`, tool metadata in `properties`, and per-occurrence source locations.
- Classical security status, quantum impact and detection confidence are reported as separate fields.

## [3.0.1]

- Previous Marketplace release.