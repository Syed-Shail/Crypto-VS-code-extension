// scripts/fix-shebang.js
const fs = require("fs");
const path = require("path");

const cliPath = path.join(__dirname, "..", "out", "cli.js");

if (!fs.existsSync(cliPath)) {
  console.error("❌ cli.js not found. Did you run `npm run compile`?");
  process.exit(1);
}

const shebang = "#!/usr/bin/env node\n";
const content = fs.readFileSync(cliPath, "utf8");

// Only prepend if missing
if (!content.startsWith(shebang)) {
  fs.writeFileSync(cliPath, shebang + content, "utf8");
  console.log("✔ Shebang added to out/cli.js");
} else {
  console.log("✔ Shebang already exists");
}
