const fs = require("fs");
const path = require("path");

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const LEGACY_CONN = "createConnection(configLegacy)";
const LEGACY_CONN_NEW = "createConnection(assertLegacyConfig())";

function patchFile(filePath) {
  let t = fs.readFileSync(filePath, "utf8");
  if (!t.includes(LEGACY_CONN)) return false;

  if (!t.includes("assertLegacyConfig")) {
    t = t.replace(
      /const\s*\{\s*configLegacy\s*\}\s*=\s*require\(['"]\.\/coceo_db_config['"]\);/g,
      "const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');"
    );
    t = t.replace(
      /const\s*\{\s*configLocal\s*,\s*configLegacy\s*\}\s*=\s*require\(['"]\.\/coceo_db_config['"]\);/g,
      "const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');"
    );
  }

  t = t.split(LEGACY_CONN).join(LEGACY_CONN_NEW);
  fs.writeFileSync(filePath, t);
  return true;
}

const root = path.join(__dirname, "..");
const selfName = path.basename(__filename);
let n = 0;
for (const f of walk(root)) {
  if (path.basename(f) === selfName && f.includes(`${path.sep}scripts${path.sep}`)) continue;
  if (patchFile(f)) {
    console.log(f);
    n++;
  }
}
console.log("Arquivos atualizados:", n);
