#!/usr/bin/env node

// src/cli.ts — Updated CLI with improved dashboard
import { Command } from "commander";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { scanFile, scanFolder, scanGithubRepo, generateCBOM, generateDashboardHtml, openInBrowser } from "./core/scan-engine";

const program = new Command();

program
  .name("crypto-detector")
  .description("CLI tool for cryptographic algorithm detection, GitHub scanning, CBOM generation and dashboards.")
  .version("2.2.0");

/* ---------------------------------------------------
   COMMAND 1: SCAN A SINGLE FILE
--------------------------------------------------- */
program
  .command("scan-file <file>")
  .description("Scan a single file for cryptographic algorithms.")
  .option("-o, --output <dir>", "Output directory for reports", "./crypto-analysis")
  .option("--no-browser", "Do not open dashboard in browser")
  .action(async (file: string, options) => {
    try {
      const filePath = path.resolve(file);

      if (!fsSync.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        process.exit(1);
      }

      console.log(`🔍 Scanning file: ${filePath}`);

      const assets = await scanFile(filePath);
      console.log(`✅ Found ${assets.length} cryptographic algorithm(s)`);

      if (assets.length === 0) {
        console.log('ℹ️  No detections to report.');
        return;
      }

      const outputDir = path.resolve(options.output);
      fsSync.mkdirSync(outputDir, { recursive: true });

      const cbomPath = path.join(outputDir, "cbom-file.json");
      await generateCBOM(assets, cbomPath);
      console.log(`📦 CBOM saved: ${cbomPath}`);

      const dashboardPath = path.join(outputDir, "dashboard-file.html");
      generateDashboardHtml(assets, dashboardPath);
      console.log(`📊 Dashboard saved: ${dashboardPath}`);

      if (options.browser !== false) {
        console.log(`🌐 Opening dashboard in browser...`);
        openInBrowser(dashboardPath);
      }
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

/* ---------------------------------------------------
   COMMAND 2: SCAN AN ENTIRE WORKSPACE / FOLDER
--------------------------------------------------- */
program
  .command("scan-workspace <folder>")
  .description("Scan an entire workspace/folder for cryptographic algorithms.")
  .option("-o, --output <dir>", "Output directory", "./crypto-analysis")
  .option("--no-browser", "Do not open dashboard")
  .action(async (folder: string, options) => {
    try {
      const root = path.resolve(folder);

      if (!fsSync.existsSync(root)) {
        console.error(`❌ Folder not found: ${root}`);
        process.exit(1);
      }

      if (!fsSync.statSync(root).isDirectory()) {
        console.error(`❌ Path is not a directory: ${root}`);
        process.exit(1);
      }

      console.log(`📁 Scanning workspace: ${root}`);
      const assets = await scanFolder(root);
      console.log(`✅ Found ${assets.length} cryptographic algorithm(s)`);

      if (assets.length === 0) {
        console.log('ℹ️  No detections to report.');
        return;
      }

      const outputDir = path.resolve(options.output);
      fsSync.mkdirSync(outputDir, { recursive: true });

      const cbomPath = path.join(outputDir, "cbom-workspace.json");
      await generateCBOM(assets, cbomPath);
      console.log(`📦 CBOM saved: ${cbomPath}`);

      const dashboardPath = path.join(outputDir, "dashboard-workspace.html");
      generateDashboardHtml(assets, dashboardPath);
      console.log(`📊 Dashboard saved: ${dashboardPath}`);

      if (options.browser !== false) {
        console.log(`🌐 Opening dashboard in browser...`);
        openInBrowser(dashboardPath);
      }
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

/* ---------------------------------------------------
   COMMAND 3: SCAN A GITHUB REPOSITORY
--------------------------------------------------- */
program
  .command("scan-github <repoUrl>")
  .description("Clone and scan a GitHub repository.")
  .option("-o, --output <dir>", "Output directory", "./crypto-analysis")
  .option("--no-browser", "Do not open dashboard")
  .action(async (repoUrl: string, options) => {
    try {
      console.log(`📥 Cloning + scanning: ${repoUrl}`);

      const outputDir = path.resolve(options.output);
      const result = await scanGithubRepo(repoUrl, outputDir);

      console.log("--------------------------------------------------");
      console.log(`📁 Repo directory : ${result.repoDir}`);
      console.log(`📊 Code files     : ${result.codeFiles}`);
      console.log(`🔍 Detections     : ${result.detections}`);
      console.log(`📦 CBOM           : ${result.cbomPath}`);
      console.log(`📊 Dashboard      : ${result.dashboardPath}`);
      console.log("--------------------------------------------------");

      if (options.browser !== false) {
        console.log(`🌐 Opening dashboard in browser...`);
        openInBrowser(result.dashboardPath);
      }
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

/* ---------------------------------------------------
   COMMAND 4: EXPORT CBOM FOR A FOLDER
--------------------------------------------------- */
program
  .command("export-cbom <folder>")
  .description("Export CBOM from all detected assets in a folder.")
  .option("-o, --output <file>", "Output cbom.json path", "./cbom.json")
  .action(async (folder: string, options) => {
    try {
      const root = path.resolve(folder);

      if (!fsSync.existsSync(root)) {
        console.error(`❌ Folder not found: ${root}`);
        process.exit(1);
      }

      console.log(`📁 Exporting CBOM for folder: ${root}`);

      const assets = await scanFolder(root);
      
      if (assets.length === 0) {
        console.log(`✅ No cryptographic algorithms detected.`);
        return;
      }

      const cbomPath = path.resolve(options.output);
      await generateCBOM(assets, cbomPath);

      console.log(`📦 CBOM saved to: ${cbomPath}`);
      console.log(`✅ Export complete (${assets.length} assets)`);
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

/* ---------------------------------------------------
   COMMAND 5: SHOW DASHBOARD
--------------------------------------------------- */
program
  .command("show-dashboard <folder>")
  .description("Generate and open a dashboard for an existing scan.")
  .option("-o, --output <file>", "Output HTML file", "./dashboard.html")
  .action(async (folder: string, options) => {
    try {
      const root = path.resolve(folder);

      if (!fsSync.existsSync(root)) {
        console.error(`❌ Folder not found: ${root}`);
        process.exit(1);
      }

      console.log(`📄 Generating dashboard from: ${root}`);

      const assets = await scanFolder(root);
      
      if (assets.length === 0) {
        console.log(`✅ No cryptographic algorithms detected.`);
        return;
      }

      const dashboardPath = path.resolve(options.output);
      generateDashboardHtml(assets, dashboardPath);

      console.log(`📊 Dashboard saved to: ${dashboardPath}`);
      console.log(`🌐 Opening in browser...`);
      openInBrowser(dashboardPath);
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}