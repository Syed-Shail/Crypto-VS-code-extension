
// src/cli.ts — Final CLI for Crypto Detector
import { Command } from "commander";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { scanFile, scanFolder, scanGithubRepo, generateCBOM, generateDashboardHtml, openInBrowser } from "./core/scan-engine";

const program = new Command();

program
  .name("crypto-detector")
  .description("CLI tool for cryptographic algorithm detection, GitHub scanning, CBOM generation and dashboards.")
  .version("2.1.0");

/* ---------------------------------------------------
   COMMAND 1: SCAN A SINGLE FILE
--------------------------------------------------- */
program
  .command("scan-file <file>")
  .description("Scan a single file for cryptographic algorithms.")
  .option("-o, --output <dir>", "Output directory for reports", "./crypto-analysis")
  .option("--no-browser", "Do not open dashboard in browser")
  .action(async (file: string, options) => {
    const filePath = path.resolve(file);
    const outputDir = path.resolve(options.output);

    if (!fsSync.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      return;
    }

    console.log(`🔍 Scanning file: ${filePath}`);

    const assets = await scanFile(filePath);

    fsSync.mkdirSync(outputDir, { recursive: true });

    const cbomPath = path.join(outputDir, "cbom-file.json");
    await generateCBOM(assets, cbomPath);

    const dashboardPath = path.join(outputDir, "dashboard-file.html");
    generateDashboardHtml(assets, dashboardPath);

    console.log(`📦 CBOM saved: ${cbomPath}`);
    console.log(`📊 Dashboard saved: ${dashboardPath}`);

    if (options.browser !== false) openInBrowser(dashboardPath);
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
    const root = path.resolve(folder);
    const outputDir = path.resolve(options.output);

    if (!fsSync.existsSync(root)) {
      console.error(`❌ Folder not found: ${root}`);
      return;
    }

    console.log(`📁 Scanning workspace: ${root}`);
    const assets = await scanFolder(root);

    fsSync.mkdirSync(outputDir, { recursive: true });

    const cbomPath = path.join(outputDir, "cbom-workspace.json");
    await generateCBOM(assets, cbomPath);

    const dashboardPath = path.join(outputDir, "dashboard-workspace.html");
    generateDashboardHtml(assets, dashboardPath);

    console.log(`📦 CBOM saved: ${cbomPath}`);
    console.log(`📊 Dashboard saved: ${dashboardPath}`);

    if (options.browser !== false) openInBrowser(dashboardPath);
  });

/* ---------------------------------------------------
   COMMAND 3: SCAN A GITHUB REPOSITORY
--------------------------------------------------- */
program
  .command("scan-github <repoUrl>")
  .description("Clone and scan a GitHub repository (supports long path cloning).")
  .option("-o, --output <dir>", "Output directory", "./crypto-analysis")
  .option("--no-browser", "Do not open dashboard")
  .action(async (repoUrl: string, options) => {
    console.log(`📥 Cloning + scanning: ${repoUrl}`);

    const outputDir = path.resolve(options.output);

    const result = await scanGithubRepo(repoUrl, outputDir);

    console.log("--------------------------------------------------");
    console.log(`📁 Repo directory : ${result.repoDir}`);
    console.log(`📊 Code files     : ${result.codeFiles}`);
    console.log(`🔍 Detections    : ${result.detections}`);
    console.log(`📦 CBOM          : ${result.cbomPath}`);
    console.log(`📊 Dashboard     : ${result.dashboardPath}`);
    console.log("--------------------------------------------------");

    if (options.browser !== false) {
      openInBrowser(result.dashboardPath);
    }
  });

/* ---------------------------------------------------
   COMMAND 4: EXPORT CBOM FOR A FOLDER
--------------------------------------------------- */
program
  .command("export-cbom <folder>")
  .description("Exports a CBOM from all detected assets in a folder.")
  .option("-o, --output <file>", "Output cbom.json path", "./cbom.json")
  .action(async (folder: string, options) => {
    const root = path.resolve(folder);
    const cbomPath = path.resolve(options.output);

    console.log(`📁 Exporting CBOM for folder: ${root}`);

    const assets = await scanFolder(root);
    await generateCBOM(assets, cbomPath);

    console.log(`📦 CBOM saved to: ${cbomPath}`);
  });

/* ---------------------------------------------------
   COMMAND 5: SHOW DASHBOARD (STATIC)
--------------------------------------------------- */
program
  .command("show-dashboard <folder>")
  .description("Generate and open a dashboard for an existing scan.")
  .option("-o, --output <file>", "Output HTML file", "./dashboard.html")
  .action(async (folder: string, options) => {
    const root = path.resolve(folder);
    const dashboardPath = path.resolve(options.output);

    console.log(`📄 Generating dashboard from: ${root}`);

    const assets = await scanFolder(root);

    generateDashboardHtml(assets, dashboardPath);

    console.log(`📊 Dashboard saved to: ${dashboardPath}`);
    openInBrowser(dashboardPath);
  });

program.parse();
