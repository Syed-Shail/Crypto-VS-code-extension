// download-grammars.js
// Run this script to download Tree-sitter WASM grammars
// Usage: node download-grammars.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const grammarsDir = path.join(__dirname, 'out', 'parser', 'grammars');

// Create directory if it doesn't exist
if (!fs.existsSync(grammarsDir)) {
  fs.mkdirSync(grammarsDir, { recursive: true });
  console.log(`✅ Created directory: ${grammarsDir}`);
}

// Grammar files to download
const grammars = [
  {
    name: 'python',
    url: 'https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.21.0/tree-sitter-python.wasm',
    filename: 'tree-sitter-python.wasm'
  },
  {
    name: 'java',
    url: 'https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.21.0/tree-sitter-java.wasm',
    filename: 'tree-sitter-java.wasm'
  },
  {
    name: 'c',
    url: 'https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.21.0/tree-sitter-c.wasm',
    filename: 'tree-sitter-c.wasm'
  },
  {
    name: 'cpp',
    url: 'https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.22.0/tree-sitter-cpp.wasm',
    filename: 'tree-sitter-cpp.wasm'
  }
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Downloading: ${url}`);
    
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function downloadAll() {
  console.log('🚀 Downloading Tree-sitter WASM grammars...\n');
  
  for (const grammar of grammars) {
    const dest = path.join(grammarsDir, grammar.filename);
    
    if (fs.existsSync(dest)) {
      console.log(`✅ ${grammar.name}: Already exists, skipping`);
      continue;
    }
    
    try {
      await downloadFile(grammar.url, dest);
      console.log(`✅ ${grammar.name}: Downloaded successfully`);
    } catch (err) {
      console.error(`❌ ${grammar.name}: Failed to download - ${err.message}`);
    }
  }
  
  console.log('\n✅ Setup complete!');
  console.log(`📁 Grammars installed in: ${grammarsDir}`);
  console.log('\n🔧 Next steps:');
  console.log('   1. Run: npm run compile');
  console.log('   2. Reload VS Code');
  console.log('   3. Test with: Crypto Detector: Scan Current File\n');
}

downloadAll().catch(err => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});