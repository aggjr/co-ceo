const fs = require("fs");
const path = require("path");

/**
 * Carrega variáveis de um arquivo .env na raiz do projeto (sem dependência dotenv).
 * Não sobrescreve variáveis já definidas no ambiente.
 */
function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

function envBool(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return /^1|true|yes|on$/i.test(String(v));
}

function legacySslOptions() {
  if (!envBool("LEGACY_MYSQL_SSL", true)) return {};
  const rejectUnauthorized = envBool("LEGACY_MYSQL_SSL_REJECT_UNAUTHORIZED", false);
  return { ssl: { rejectUnauthorized } };
}

const configLocal = {
  host: process.env.LOCAL_MYSQL_HOST || "localhost",
  port: Number(process.env.LOCAL_MYSQL_PORT || 3306),
  user: process.env.LOCAL_MYSQL_USER || "root",
  password: process.env.LOCAL_MYSQL_PASSWORD ?? "",
  database: process.env.LOCAL_MYSQL_DATABASE || "stockspin_db",
};

const configCeo = {
  host: process.env.CEO_MYSQL_HOST || process.env.LOCAL_MYSQL_HOST || "localhost",
  port: Number(process.env.CEO_MYSQL_PORT || process.env.LOCAL_MYSQL_PORT || 3306),
  user: process.env.CEO_MYSQL_USER || process.env.LOCAL_MYSQL_USER || "root",
  password:
    process.env.CEO_MYSQL_PASSWORD !== undefined
      ? process.env.CEO_MYSQL_PASSWORD
      : (process.env.LOCAL_MYSQL_PASSWORD ?? ""),
  database: process.env.CEO_MYSQL_DATABASE || "ceo",
};

const legacyHost = process.env.LEGACY_MYSQL_HOST;
const legacyUser = process.env.LEGACY_MYSQL_USER;
const legacyPassword = process.env.LEGACY_MYSQL_PASSWORD;
const legacyDatabase = process.env.LEGACY_MYSQL_DATABASE;

const configLegacy =
  legacyHost && legacyUser && legacyPassword !== undefined && legacyDatabase
    ? {
        host: legacyHost,
        port: Number(process.env.LEGACY_MYSQL_PORT || 3306),
        user: legacyUser,
        password: legacyPassword,
        database: legacyDatabase,
        ...legacySslOptions(),
      }
    : null;

/** Use em createConnection(assertLegacyConfig()) para mensagem clara se faltar .env */
function assertLegacyConfig() {
  if (!configLegacy) {
    throw new Error(
      "MySQL legado não configurado: crie o arquivo .env na raiz do projeto com LEGACY_MYSQL_HOST, LEGACY_MYSQL_USER, LEGACY_MYSQL_PASSWORD e LEGACY_MYSQL_DATABASE (veja .env.example)."
    );
  }
  return configLegacy;
}

module.exports = { configLocal, configCeo, configLegacy, assertLegacyConfig };
