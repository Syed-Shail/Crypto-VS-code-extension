// scripts/copy-resources.js
const fs = require('fs');
const path = require('path');

function copyFileSync(source, target) {
  let targetFile = target;

  // If target is a directory, a new file with the same name will be created
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isDirectory()) {
      targetFile = path.join(target, path.basename(source));
    }
  }

  fs.writeFileSync(targetFile, fs.readFileSync(source));
}

function copyFolderRecursiveSync(source, target) {
  let files = [];

  // Check if folder needs to be created
  const targetFolder = path.join(target, path.basename(source));
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  // Copy
  if (fs.lstatSync(source).isDirectory()) {
    files = fs.readdirSync(source);
    files.forEach(function (file) {
      const curSource = path.join(source, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, targetFolder);
      } else {
        copyFileSync(curSource, targetFolder);
      }
    });
  }
}

// Ensure output directories exist
const outDir = path.join(__dirname, '..', 'out');
const outParserDir = path.join(outDir, 'parser');
const outRulesDir = path.join(outParserDir, 'rules');
const outGrammarsDir = path.join(outParserDir, 'grammars');

[outDir, outParserDir, outRulesDir, outGrammarsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Copy crypto-rules.json
const rulesSource = path.join(__dirname, '..', 'src', 'parser', 'rules', 'crypto-rules.json');
const rulesTarget = path.join(outRulesDir, 'crypto-rules.json');
if (fs.existsSync(rulesSource)) {
  copyFileSync(rulesSource, rulesTarget);
  console.log('✅ Copied crypto-rules.json');
} else {
  console.warn('⚠️  crypto-rules.json not found at', rulesSource);
}

// Copy grammar files
const grammarsSource = path.join(__dirname, '..', 'grammars');
if (fs.existsSync(grammarsSource)) {
  const grammarFiles = fs.readdirSync(grammarsSource).filter(f => f.endsWith('.wasm'));
  grammarFiles.forEach(file => {
    const source = path.join(grammarsSource, file);
    const target = path.join(outGrammarsDir, file);
    copyFileSync(source, target);
    console.log(`✅ Copied ${file}`);
  });
} else {
  console.warn('⚠️  grammars directory not found. Run npm run download-grammars first.');
}

console.log('✅ Resource copying complete!');