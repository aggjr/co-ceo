/**
 * Gera relatório DESCRIBE de todas as tabelas do MySQL legado (STOCKSPIN).
 * Credenciais: apenas .env + coceo_db_config (assertLegacyConfig). Nada hardcoded.
 * Saída: data/mapping/schema_report_legacy.generated.md
 */
"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require(path.join(__dirname, "coceo_db_config"));

const OUT_DIR = path.join(__dirname, "data", "mapping");
const OUT_FILE = path.join(OUT_DIR, "schema_report_legacy.generated.md");

async function mapSchema() {
  const config = assertLegacyConfig();
  const safeDb = String(config.database || "");
  console.log("Mapeando schema legado (database=" + safeDb + ")...");

  const connection = await mysql.createConnection(config);
  try {
    const [tables] = await connection.query("SHOW TABLES");
    let report = "# Schema legado (gerado automaticamente)\n\n";
    report += `Gerado em: ${new Date().toISOString()}\n\n`;
    report += `**Host:** \`${String(config.host)}\` · **Database:** \`${safeDb}\`\n\n`;
    report +=
      "Este arquivo é gerado por `database_mapper.js` a partir do MySQL configurado em `.env` (`LEGACY_MYSQL_*`). Não edite manualmente.\n\n";

    for (const table of tables) {
      const tableName = Object.values(table)[0];
      const esc = "`" + String(tableName).replace(/`/g, "``") + "`";
      console.log("Mapping table:", tableName);

      report += "## Tabela " + esc + "\n\n";
      const [columns] = await connection.query("DESCRIBE " + esc);
      report += "| Campo | Tipo | Nulo | Chave | Padrão | Extra |\n";
      report += "|-------|------|------|-------|--------|-------|\n";

      for (const col of columns) {
        report += `| ${col.Field} | ${col.Type} | ${col.Null} | ${col.Key} | ${col.Default != null ? col.Default : ""} | ${col.Extra || ""} |\n`;
      }
      report += "\n---\n\n";
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, report, "utf8");
    console.log("Relatório:", OUT_FILE);
  } finally {
    await connection.end();
  }
}

mapSchema().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
