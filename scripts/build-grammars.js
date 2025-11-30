// scripts/build-grammars.js
// Build WASM grammars from installed npm packages using tree-sitter-cli

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GRAMMAR_DIR = path.join(__dirname, '..', 'grammars');
const NODE_MODULES = path.join(__dirname, '..', 'node_modules');

// Ensure grammars directory exists
if (!fs.existsSync(GRAMMAR_DIR)) {
  fs.mkdirSync(GRAMMAR_DIR, { recursive: true });
}

const grammars = [
  { pkg: 'tree-sitter-python', file: 'tree-sitter-python.wasm' },
  { pkg: 'tree-sitter-java', file: 'tree-sitter-java.wasm' },
  { pkg: 'tree-sitter-c', file: 'tree-sitter-c.wasm' },
  { pkg: 'tree-sitter-cpp', file: 'tree-sitter-cpp.wasm' },
  { pkg: 'tree-sitter-javascript', file: 'tree-sitter-javascript.wasm' }
];

console.log('\n🔨 Building tree-sitter grammar WASM files...\n');
console.log('This requires tree-sitter-cli and may take a few minutes...\n');

let successCount = 0;
let failCount = 0;

for (const grammar of grammars) {
  const dest = path.join(GRAMMAR_DIR, grammar.file);
  
  // Skip if already exists and not empty
  if (fs.existsSync(dest)) {
    const stats = fs.statSync(dest);
    if (stats.size > 0) {
      console.log(`✓ ${grammar.file} already exists (${Math.round(stats.size / 1024)}KB), skipping...`);
      successCount++;
      continue;
    }
  }

  const pkgPath = path.join(NODE_MODULES, grammar.pkg);
  
  if (!fs.existsSync(pkgPath)) {
    console.log(`❌ Package ${grammar.pkg} not found in node_modules`);
    failCount++;
    continue;
  }

  try {
    console.log(`🔨 Building ${grammar.file}...`);
    
    // Use npx to run tree-sitter build
    const buildCmd = `npx tree-sitter build --wasm "${pkgPath}"`;
    execSync(buildCmd, { 
      stdio: 'inherit',
      cwd: GRAMMAR_DIR  // Output to grammars directory
    });
    
    // Check if file was created
    if (fs.existsSync(dest)) {
      const stats = fs.statSync(dest);
      console.log(`✅ Built ${grammar.file} (${Math.round(stats.size / 1024)}KB)`);
      successCount++;
    } else {
      console.log(`⚠️  Build completed but ${grammar.file} not found`);
      failCount++;
    }
  } catch (err) {
    console.error(`❌ Failed to build ${grammar.pkg}:`, err.message);
    failCount++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`✅ Successfully built: ${successCount}/${grammars.length}`);
if (failCount > 0) {
  console.log(`❌ Failed: ${failCount}`);
}
console.log(`📁 Grammars directory: ${GRAMMAR_DIR}`);
console.log('='.repeat(60) + '\n');

if (successCount === 0) {
  console.log('⚠️  No grammar files were built.');
  console.log('Make sure you have:');
  console.log('  1. Docker, Podman, or Emscripten installed');
  console.log('  2. Run: npm install --save-dev tree-sitter-cli');
  console.log('\nThe extension will fall back to regex-only detection.\n');
} else if (successCount < grammars.length) {
  console.log('\n💡 Some grammars failed to build.');
  console.log('The extension will use available grammars + regex detection.\n');
}