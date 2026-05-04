/**
 * Clona o schema completo do MySQL legado (ex.: stockspin_core_db_saron, ~55 tabelas)
 * para o MySQL local, via mysqldump | mysql.
 *
 * Pré-requisitos:
 *   - Clientes `mysqldump` e `mysql` no PATH (MySQL 8 / MariaDB client).
 *   - .env na raiz com LEGACY_MYSQL_* e CEO_MYSQL_* (ou LOCAL_* para senha).
 *
 * Variáveis:
 *   REPLICA_TARGET_DATABASE — schema local (padrão: mesmo nome do legado).
 *     Use `ceo` só se quiser tudo no schema do piloto (há risco de DROP em nomes iguais).
 *   MYSQLDUMP_BIN / MYSQL_BIN — caminhos absolutos se necessário.
 *   REPLICA_SKIP_CREATE_DB=1 — não cria o schema antes.
 *   REPLICA_STRIP_DEFINER=1 — remove DEFINER de views/routines (útil se o usuário local não existir).
 *   REPLICA_MYSQLDUMP_EXTRA — substitui flags extras (lista separada por espaço).
 *   Por padrão inclui --max_allowed_packet=512M (ajuda em tabelas muito grandes).
 *
 * Uso: node scripts/replicate_legacy_to_local.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Transform } = require("stream");
const mysql = require("mysql2/promise");

const root = path.join(__dirname, "..");
const { assertLegacyConfig, configCeo } = require(path.join(root, "coceo_db_config"));

function assertSafeDbName(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(String(name))) {
    throw new Error("Nome de banco inválido (use apenas letras, números e _): " + name);
  }
  return String(name);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCnfValue(p) {
  return '"' + String(p).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function writeClientCnf(filePath, opts) {
  const lines = ["[client]", `host=${opts.host}`, `port=${opts.port}`, `user=${opts.user}`];
  lines.push(`password=${escapeCnfValue(opts.password)}`);
  if (opts.sslMode) {
    lines.push(`ssl-mode=${opts.sslMode}`);
  }
  if (opts.sslVerifyServerCert === false && process.env.LEGACY_SSL_VERIFY_CNF !== "0") {
    lines.push("ssl-verify-server-cert=FALSE");
  }
  try {
    fs.writeFileSync(filePath, lines.join("\n") + "\n", { mode: 0o600 });
  } catch (_) {
    fs.writeFileSync(filePath, lines.join("\n") + "\n");
  }
}

function findOnPath(cmd) {
  const isWin = process.platform === "win32";
  try {
    const which = isWin ? "where" : "which";
    const { execSync } = require("child_process");
    const out = execSync(`${which} ${cmd}`, { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (out && !out.toLowerCase().includes("informações") && !out.toLowerCase().includes("not found")) {
      return out.trim();
    }
  } catch (_) {
    /* ignore */
  }
  return cmd;
}

function chunkToUtf8(chunk, enc) {
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  if (enc === "buffer" || !enc) return Buffer.from(chunk).toString("utf8");
  return Buffer.from(chunk, enc).toString("utf8");
}

function useDatabaseTransform(sourceDb, targetDb) {
  const re = new RegExp("^USE\\s+[`']?" + escapeRegex(sourceDb) + "[`']?\\s*;", "gim");
  return new Transform({
    transform(chunk, enc, cb) {
      try {
        let s = chunkToUtf8(chunk, enc);
        s = s.replace(re, "USE `" + targetDb + "`;");
        cb(null, s);
      } catch (e) {
        cb(e);
      }
    },
  });
}

function stripDefinerTransform() {
  return new Transform({
    transform(chunk, enc, cb) {
      try {
        let s = chunkToUtf8(chunk, enc);
        s = s.replace(/DEFINER\s*=\s*`[^`]+`@`[^`]+`\s*/gi, "");
        cb(null, s);
      } catch (e) {
        cb(e);
      }
    },
  });
}

function runPipe(dumpExe, dumpArgs, mysqlExe, mysqlArgs, sourceDb, targetDb, stripDefiner) {
  return new Promise((resolve, reject) => {
    const dump = spawn(dumpExe, dumpArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const client = spawn(mysqlExe, mysqlArgs, { stdio: ["pipe", "pipe", "pipe"] });

    const x1 = useDatabaseTransform(sourceDb, targetDb);
    let pipe = dump.stdout.pipe(x1);
    if (stripDefiner) {
      const x2 = stripDefinerTransform();
      pipe = pipe.pipe(x2);
      x2.on("error", reject);
    }
    pipe.pipe(client.stdin);

    x1.on("error", reject);

    dump.stderr.on("data", (d) => process.stderr.write(d));
    client.stderr.on("data", (d) => process.stderr.write(d));

    dump.on("error", reject);
    client.on("error", reject);

    let dumpCode;
    let mysqlCode;
    let pending = 2;
    function doneOne() {
      pending--;
      if (pending > 0) return;
      if (dumpCode !== 0) return reject(new Error("mysqldump saiu com código " + dumpCode));
      if (mysqlCode !== 0) return reject(new Error("mysql saiu com código " + mysqlCode));
      resolve();
    }

    dump.on("close", (code) => {
      dumpCode = code;
      if (code !== 0) {
        try {
          client.stdin.end();
        } catch (_) {
          /* ignore */
        }
      }
      doneOne();
    });
    client.on("close", (code) => {
      mysqlCode = code;
      doneOne();
    });
  });
}

async function main() {
  const legacy = assertLegacyConfig();
  const sourceDb = assertSafeDbName(legacy.database);
  const targetDb = assertSafeDbName(
    process.env.REPLICA_TARGET_DATABASE || process.env.REPLICA_LOCAL_DATABASE || sourceDb
  );

  const mysqldump = process.env.MYSQLDUMP_BIN || findOnPath("mysqldump");
  const mysqlBin = process.env.MYSQL_BIN || findOnPath("mysql");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coceo-replica-"));
  const legacyCnf = path.join(tmp, "legacy.cnf");
  const localCnf = path.join(tmp, "local.cnf");

  const sslMode = process.env.LEGACY_MYSQL_SSL === "0" ? null : "REQUIRED";
  const sslVerify = process.env.LEGACY_MYSQL_SSL_REJECT_UNAUTHORIZED === "true";

  writeClientCnf(legacyCnf, {
    host: legacy.host,
    port: legacy.port,
    user: legacy.user,
    password: legacy.password,
    sslMode,
    sslVerifyServerCert: sslVerify,
  });

  writeClientCnf(localCnf, {
    host: configCeo.host,
    port: configCeo.port,
    user: configCeo.user,
    password: configCeo.password,
  });

  console.log("Origem (legado):", legacy.host, "/", sourceDb);
  console.log("Destino (local):", configCeo.host, "/", targetDb);
  if (targetDb === "ceo") {
    console.warn(
      "\n[Aviso] Destino é o schema `ceo`. O dump inclui DROP TABLE IF EXISTS para cada tabela do legado.\n" +
        "Tabelas Co-CEO (engine_run, daily_stock_snapshot, …) só serão afetadas se tiverem o mesmo nome de uma tabela do legado.\n"
    );
  }

  const conn = await mysql.createConnection({
    host: configCeo.host,
    port: configCeo.port,
    user: configCeo.user,
    password: configCeo.password,
    multipleStatements: true,
  });

  if (!process.env.REPLICA_SKIP_CREATE_DB) {
    await conn.query(
      "CREATE DATABASE IF NOT EXISTS `" +
        targetDb +
        "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
  }
  await conn.end();

  let dumpExtra;
  if (process.env.REPLICA_MYSQLDUMP_EXTRA) {
    dumpExtra = process.env.REPLICA_MYSQLDUMP_EXTRA.split(/\s+/).filter(Boolean);
  } else {
    dumpExtra = [
      "--single-transaction",
      "--routines",
      "--triggers",
      "--set-gtid-purged=OFF",
      "--column-statistics=0",
      "--default-character-set=utf8mb4",
      "--max_allowed_packet=512M",
      "--net_buffer_length=16384",
    ];
  }

  const dumpArgs = [
    `--defaults-extra-file=${legacyCnf}`,
    ...dumpExtra,
    sourceDb,
  ];

  const mysqlArgs = [`--defaults-extra-file=${localCnf}`, `-D${targetDb}`];

  const stripDefiner = process.env.REPLICA_STRIP_DEFINER === "1" || process.env.REPLICA_STRIP_DEFINER === "true";

  console.log("\nIniciando mysqldump | mysql (pode demorar vários minutos)...\n");

  try {
    await runPipe(mysqldump, dumpArgs, mysqlBin, mysqlArgs, sourceDb, targetDb, stripDefiner);
    console.log("\nConcluído. Schema local:", targetDb);
    console.log('Conferir: mysql -u ... -p -e "SHOW TABLES" ' + targetDb);
  } finally {
    try {
      fs.unlinkSync(legacyCnf);
      fs.unlinkSync(localCnf);
      fs.rmdirSync(tmp);
    } catch (_) {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
