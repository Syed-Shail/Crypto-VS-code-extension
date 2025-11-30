// scripts/download-grammars.js
const https = require('https');
const fs = require('fs');
const path = require('path');

const GRAMMAR_DIR = path.join(__dirname, '..', 'grammars');

// Using CDN links that are known to work
const GRAMMARS = {
  'tree-sitter-python.wasm': 'https://cdn.jsdelivr.net/npm/tree-sitter-python@0.20.4/tree-sitter-python.wasm',
  'tree-sitter-java.wasm': 'https://cdn.jsdelivr.net/npm/tree-sitter-java@0.20.2/tree-sitter-java.wasm',
  'tree-sitter-c.wasm': 'https://cdn.jsdelivr.net/npm/tree-sitter-c@0.20.6/tree-sitter-c.wasm',
  'tree-sitter-cpp.wasm': 'https://cdn.jsdelivr.net/npm/tree-sitter-cpp@0.20.3/tree-sitter-cpp.wasm',
  'tree-sitter-javascript.wasm': 'https://cdn.jsdelivr.net/npm/tree-sitter-javascript@0.20.1/tree-sitter-javascript.wasm'
};

// Ensure grammars directory exists
if (!fs.existsSync(GRAMMAR_DIR)) {
  fs.mkdirSync(GRAMMAR_DIR, { recursive: true });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    const client = url.startsWith('https') ? https : require('http');
    
    client.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {}); // Delete the file on error
      reject(err);
    });

    file.on('error', (err) => {
      fs.unlink(dest, () => {}); // Delete the file on error
      reject(err);
    });
  });
}

async function downloadGrammars() {
  console.log('📥 Downloading tree-sitter grammar files...\n');

  let successCount = 0;
  let failCount = 0;

  for (const [filename, url] of Object.entries(GRAMMARS)) {
    const dest = path.join(GRAMMAR_DIR, filename);
    
    // Skip if already exists
    if (fs.existsSync(dest)) {
      const stats = fs.statSync(dest);
      if (stats.size > 0) {
        console.log(`✓ ${filename} already exists (${Math.round(stats.size / 1024)}KB), skipping...`);
        successCount++;
        continue;
      } else {
        // File exists but is empty, re-download
        fs.unlinkSync(dest);
      }
    }

    try {
      console.log(`📥 Downloading ${filename}...`);
      await downloadFile(url, dest);
      const stats = fs.statSync(dest);
      console.log(`✅ Downloaded ${filename} (${Math.round(stats.size / 1024)}KB)`);
      successCount++;
    } catch (error) {
      console.error(`❌ Failed to download ${filename}:`, error.message);
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Successfully downloaded: ${successCount}/${Object.keys(GRAMMARS).length}`);
  if (failCount > 0) {
    console.log(`❌ Failed downloads: ${failCount}`);
  }
  console.log(`📁 Grammars saved to: ${GRAMMAR_DIR}`);
  console.log('='.repeat(60));

  if (successCount === 0) {
    console.log('\n⚠️  WARNING: No grammar files were downloaded!');
    console.log('The extension will fall back to regex-only detection.');
    console.log('\nYou can manually download grammar files from:');
    console.log('https://github.com/tree-sitter/tree-sitter-python/releases');
    console.log('https://github.com/tree-sitter/tree-sitter-java/releases');
    console.log('https://github.com/tree-sitter/tree-sitter-c/releases');
    console.log('https://github.com/tree-sitter/tree-sitter-cpp/releases');
    console.log('https://github.com/tree-sitter/tree-sitter-javascript/releases');
  }
}

downloadGrammars().catch(err => {
  console.error('❌ Fatal error during grammar download:', err);
  process.exit(0); // Don't fail the install
});