#!/usr/bin/env node
/* src/cli.ts
   CLI entry that reuses scan-engine.ts
*/


import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import {
  scanFile,
  scanFolder,
  scanGithubRepo,
  generateCBOM,
  generateDashboardHtml,
  openInBrowser,
  CryptoAsset
} from './core/scan-engine';

const program = new Command();
program.name('crypto-detector').description('Crypto Detector CLI').version('2.0.0');

/* ---------- Command: scan-file ---------- */
program
  .command('scan-file <file>')
  .description('Scan a single file for cryptographic algorithms')
  .option('-o, --output <dir>', 'Output directory', './crypto-analysis')
  .option('--no-browser', 'Do not open the dashboard')
  .action(async (file: string, options) => {
    const filePath = path.resolve(file);
    if (!fsSync.existsSync(filePath)) {
      console.error('❌ File not found:', filePath);
      process.exitCode = 1;
      return;
    }

    const assets = await scanFile(filePath);
    await fs.mkdir(path.resolve(options.output), { recursive: true });
    const cbomPath = path.join(options.output, `${path.basename(file)}-cbom.json`);
    await generateCBOM(assets, cbomPath);
    const dashboardPath = path.join(options.output, `${path.basename(file)}-dashboard.html`);
    generateDashboardHtml(assets, dashboardPath);

    console.log('📦 CBOM:', cbomPath);
    console.log('📊 Dashboard:', dashboardPath);
    if (options.browser !== false) {
      try { openInBrowser(dashboardPath); } catch { console.log('💡 Open manually:', dashboardPath); }
    }
  });

/* ---------- Command: scan-workspace ---------- */
program
  .command('scan-workspace <folder>')
  .description('Scan a folder/workspace for cryptographic algorithms')
  .option('-o, --output <dir>', 'Output directory', './crypto-analysis')
  .option('--no-browser', 'Do not open the dashboard')
  .action(async (folder: string, options) => {
    const folderPath = path.resolve(folder);
    if (!fsSync.existsSync(folderPath)) {
      console.error('❌ Folder not found:', folderPath);
      process.exitCode = 1;
      return;
    }

    const assets = await scanFolder(folderPath);
    await fs.mkdir(path.resolve(options.output), { recursive: true });
    const cbomPath = path.join(options.output, `workspace-cbom.json`);
    await generateCBOM(assets, cbomPath);
    const dashboardPath = path.join(options.output, `workspace-dashboard.html`);
    generateDashboardHtml(assets, dashboardPath);

    console.log('📦 CBOM:', cbomPath);
    console.log('📊 Dashboard:', dashboardPath);
    if (options.browser !== false) {
      try { openInBrowser(dashboardPath); } catch { console.log('💡 Open manually:', dashboardPath); }
    }
  });

/* ---------- Command: scan-github ---------- */
program
  .command('scan-github <repoUrl>')
  .description('Clone and scan a GitHub repository (https or git@)')
  .option('-o, --output <dir>', 'Output directory', './crypto-analysis')
  .option('--no-browser', 'Do not open the dashboard')
  .action(async (repoUrl: string, options) => {
    try {
      console.log('📥 Cloning and scanning repository...');
      const { assets, repoPath } = await scanGithubRepo(repoUrl);
      await fs.mkdir(path.resolve(options.output), { recursive: true });
      const repoName = path.basename(repoPath);
      const cbomPath = path.join(options.output, `${repoName}-cbom.json`);
      await generateCBOM(assets, cbomPath);
      const dashboardPath = path.join(options.output, `${repoName}-dashboard.html`);
      generateDashboardHtml(assets, dashboardPath);

      console.log('📦 CBOM:', cbomPath);
      console.log('📊 Dashboard:', dashboardPath);
      if (options.browser !== false) {
        try { openInBrowser(dashboardPath); } catch { console.log('💡 Open manually:', dashboardPath); }
      }
    } catch (err: any) {
      console.error('❌ Failed to scan GitHub repository:', err.message || err);
      process.exitCode = 1;
    }
  });

/* ---------- Command: export-cbom ---------- */
program
  .command('export-cbom <inputJson>')
  .description('Convert a previous scan JSON (array of CryptoAsset) into CycloneDX CBOM')
  .option('-o, --output <file>', 'Output CBOM path', './cbom-export.json')
  .action(async (inputJson: string, options) => {
    try {
      const content = await fs.readFile(path.resolve(inputJson), 'utf8');
      const assets = JSON.parse(content) as CryptoAsset[];
      await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
      await generateCBOM(assets, path.resolve(options.output));
      console.log('✅ Exported CBOM to', path.resolve(options.output));
    } catch (err: any) {
      console.error('❌ Failed to export CBOM:', err.message || err);
      process.exitCode = 1;
    }
  });

/* ---------- Command: show-dashboard ---------- */
program
  .command('show-dashboard <dashboardPath>')
  .description('Open a previously generated dashboard HTML file in the browser')
  .action((dashboardPath: string) => {
    const p = path.resolve(dashboardPath);
    if (!fsSync.existsSync(p)) {
      console.error('❌ Dashboard not found:', p);
      process.exitCode = 1;
      return;
    }
    try { openInBrowser(p); } catch { console.log('💡 Open manually:', p); }
  });

program.parse(process.argv);
