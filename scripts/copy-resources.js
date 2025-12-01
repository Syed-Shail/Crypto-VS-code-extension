// scripts/copy-resources.js
const fs = require('fs');
const path = require('path');

console.log('\n📦 Copying resources...\n');

function copyFileSync(source, target) {
  if (!fs.existsSync(source)) {
    console.warn(`⚠️  Source not found: ${source}`);
    return false;
  }

  let targetFile = target;

  // If target is a directory, create a file with the same name
  if (fs.existsSync(target) && fs.lstatSync(target).isDirectory()) {
    targetFile = path.join(target, path.basename(source));
  }

  try {
    fs.writeFileSync(targetFile, fs.readFileSync(source));
    return true;
  } catch (err) {
    console.error(`❌ Failed to copy ${source}:`, err.message);
    return false;
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Ensure output directories exist
const outDir = path.join(__dirname, '..', 'out');
const outParserDir = path.join(outDir, 'parser');
const outRulesDir = path.join(outParserDir, 'rules');
const outGrammarsDir = path.join(outParserDir, 'grammars');

[outDir, outParserDir, outRulesDir, outGrammarsDir].forEach(ensureDir);

// Copy crypto-rules.json
const rulesSource = path.join(__dirname, '..', 'src', 'parser', 'rules', 'crypto-rules.json');
const rulesTarget = path.join(outRulesDir, 'crypto-rules.json');

if (copyFileSync(rulesSource, rulesTarget)) {
  console.log('✅ Copied crypto-rules.json');
} else {
  console.error('❌ Failed to copy crypto-rules.json');
}

// Copy WASM grammar files from grammars/ directory
const grammarsSource = path.join(__dirname, '..', 'grammars');

if (fs.existsSync(grammarsSource)) {
  const grammarFiles = fs.readdirSync(grammarsSource).filter(f => f.endsWith('.wasm'));
  
  if (grammarFiles.length === 0) {
    console.warn('⚠️  No .wasm files found in grammars/ directory');
    console.warn('   Extension will use regex-only detection');
  } else {
    grammarFiles.forEach(file => {
      const source = path.join(grammarsSource, file);
      const target = path.join(outGrammarsDir, file);
      if (copyFileSync(source, target)) {
        const stats = fs.statSync(target);
        console.log(`✅ Copied ${file} (${Math.round(stats.size / 1024)}KB)`);
      }
    });
  }
} else {
  console.warn('⚠️  grammars/ directory not found');
  console.warn('   Create it and add .wasm files, or extension will use regex-only detection');
}

console.log('\n✅ Resource copying complete!\n');