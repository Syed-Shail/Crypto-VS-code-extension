// scripts/setup-directories.js
// Run this once to create the proper directory structure

const fs = require('fs');
const path = require('path');

console.log('\n📁 Setting up directory structure...\n');

const dirs = [
  'grammars',
  'scripts',
  'src/parser/rules',
  'src/commands',
  'out/parser/rules',
  'out/parser/grammars'
];

dirs.forEach(dir => {
  const fullPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`✅ Created: ${dir}/`);
  } else {
    console.log(`✓  Exists: ${dir}/`);
  }
});

console.log('\n✅ Directory structure ready!\n');
console.log('Next steps:');
console.log('  1. Put your .wasm files in the grammars/ directory');
console.log('  2. Make sure crypto-rules.json is in src/parser/rules/');
console.log('  3. Run: npm run compile\n');