// scripts/copy-wasms.js
// Copy pre-built WASM files from tree-sitter-wasms package

const fs = require('fs');
const path = require('path');

const GRAMMAR_DIR = path.join(__dirname, '..', 'grammars');
const WASMS_PKG = path.join(__dirname, '..', 'node_modules', 'tree-sitter-wasms', 'out');

// Create grammars directory if it doesn't exist
if (!fs.existsSync(GRAMMAR_DIR)) {
  fs.mkdirSync(GRAMMAR_DIR, { recursive: true });
}

// Check if tree-sitter-wasms is installed
if (!fs.existsSync(WASMS_PKG)) {
  console.error('❌ tree-sitter-wasms package not found!');
  console.error('   Run: npm install');
  process.exit(1);
}

const grammars = [
  'tree-sitter-python.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-c.wasm',
  'tree-sitter-cpp.wasm',
  'tree-sitter-javascript.wasm'
];

console.log('\n📦 Copying pre-built WASM files from tree-sitter-wasms...\n');

let successCount = 0;
let failCount = 0;

for (const grammar of grammars) {
  const src = path.join(WASMS_PKG, grammar);
  const dest = path.join(GRAMMAR_DIR, grammar);
  
  if (!fs.existsSync(src)) {
    console.log(`⚠️  ${grammar} not found in package`);
    failCount++;
    continue;
  }
  
  try {
    fs.copyFileSync(src, dest);
    const stats = fs.statSync(dest);
    console.log(`✅ Copied ${grammar} (${Math.round(stats.size / 1024)}KB)`);
    successCount++;
  } catch (err) {
    console.error(`❌ Failed to copy ${grammar}:`, err.message);
    failCount++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`✅ Successfully copied: ${successCount}/${grammars.length}`);
if (failCount > 0) {
  console.log(`❌ Failed: ${failCount}`);
}
console.log(`📁 Grammars directory: ${GRAMMAR_DIR}`);
console.log('='.repeat(60) + '\n');

if (successCount === 0) {
  console.error('❌ No grammar files were copied!');
  console.error('   Make sure tree-sitter-wasms is installed.');
  process.exit(1);
}

console.log('✨ Ready! Run "npm run compile" to build the extension.\n');