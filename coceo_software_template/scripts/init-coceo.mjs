#!/usr/bin/env node
/**
 * Inicialização CO-CEO: dependências, .env a partir de exemplos, seed tenants (opcional),
 * e subida do backend (:3001) + frontend Vite (:5173) em paralelo.
 *
 * Uso (na pasta coceo_software_template):
 *   node scripts/init-coceo.mjs
 *   npm run coceo:init
 *
 * Opções:
 *   --no-install     Não executa npm install
 *   --no-seed        Não tenta npm run db:seed-saron no backend
 *   --install-only   Só instala + .env + seed; não sobe servidores
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const backend = path.join(root, "backend");

const argv = new Set(process.argv.slice(2));
const noInstall = argv.has("--no-install");
const noSeed = argv.has("--no-seed");
const installOnly = argv.has("--install-only");

function run(cmd, cwd = root, { soft = false } = {}) {
  const r = spawnSync(cmd, { cwd, shell: true, stdio: "inherit", env: { ...process.env } });
  const ok = r.status === 0 || r.status == null;
  if (!soft && !ok) process.exit(r.status ?? 1);
  return ok;
}

function copyEnvIfMissing(examplePath, destPath) {
  if (fs.existsSync(destPath) || !fs.existsSync(examplePath)) return;
  fs.copyFileSync(examplePath, destPath);
  console.log(`[CO-CEO] Criado ${path.relative(root, destPath)} ← ${path.basename(examplePath)}`);
}

console.log("\n=== CO-CEO — inicialização ===\n");

if (!noInstall) {
  console.log("[1/4] npm install (frontend / raiz do template)…\n");
  run("npm install", root);
  console.log("\n[2/4] npm install (backend)…\n");
  run("npm install", backend);
} else {
  console.log("[1–2/4] npm install ignorado (--no-install)\n");
}

console.log("\n[3/4] Ficheiros .env (se ainda não existirem)…\n");
copyEnvIfMissing(path.join(backend, ".env.example"), path.join(backend, ".env"));
copyEnvIfMissing(path.join(root, ".env.example"), path.join(root, ".env"));

if (!noSeed) {
  console.log("\n[4a/4] Seed tenants demo + SARON (ignora falha se MySQL não estiver acessível)…\n");
  const ok = run("npm run db:seed-saron", backend, { soft: true });
  if (!ok) {
    console.warn(
      "\n[CO-CEO] Aviso: db:seed-saron falhou. Configure backend/.env (DB_*) e MySQL; depois: cd backend && npm run db:seed-saron\n"
    );
  }
} else {
  console.log("\n[4a/4] Seed ignorado (--no-seed)\n");
}

if (installOnly) {
  console.log("\n=== Concluído (--install-only) ===");
  console.log("Subir manualmente:  npm run dev:all\n");
  process.exit(0);
}

console.log("\n[4b/4] Backend (porta 3001) + Frontend Vite (5173). Ctrl+C encerra ambos.\n");
const r = spawnSync("npm run dev:all", { cwd: root, shell: true, stdio: "inherit" });
process.exit(r.status ?? 0);
