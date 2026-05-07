"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VERSION_JS_PATH = path.join(ROOT, "coceo_software_template", "src", "utils", "version.js");
const FRONT_PACKAGE_PATH = path.join(ROOT, "coceo_software_template", "package.json");
const FRONT_LOCK_PATH = path.join(ROOT, "coceo_software_template", "package-lock.json");
const BACK_PACKAGE_PATH = path.join(ROOT, "coceo_software_template", "backend", "package.json");
const BACK_LOCK_PATH = path.join(ROOT, "coceo_software_template", "backend", "package-lock.json");
const BACK_SERVER_PATH = path.join(ROOT, "coceo_software_template", "backend", "server.js");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + "\n", "utf8");
}

function parseVersion(versionText) {
  const m = String(versionText || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Versão inválida: ${versionText}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function bumpPatch(versionText) {
  const v = parseVersion(versionText);
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

function readAppVersionFromJs(content) {
  const m = content.match(/APP_VERSION\s*=\s*['"]v-(\d+\.\d+\.\d+)['"]/);
  if (!m) throw new Error("Não foi possível localizar APP_VERSION em version.js");
  return m[1];
}

function updateAppVersionJs(content, newVersion) {
  return content.replace(
    /APP_VERSION\s*=\s*['"]v-(\d+\.\d+\.\d+)['"]/,
    `APP_VERSION = 'v-${newVersion}'`
  );
}

function bumpPackageLockVersion(content, fromVersion, toVersion) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`"version":\\s*"${esc(fromVersion)}"`, "g");
  return content.replace(re, `"version": "${toVersion}"`);
}

function updateServerHealthVersion(content, newVersion) {
  return content.replace(/version:\s*['"]\d+\.\d+\.\d+['"]/, `version: '${newVersion}'`);
}

function main() {
  const versionJsRaw = fs.readFileSync(VERSION_JS_PATH, "utf8");
  const current = readAppVersionFromJs(versionJsRaw);
  const next = bumpPatch(current);

  const updatedVersionJs = updateAppVersionJs(versionJsRaw, next);
  fs.writeFileSync(VERSION_JS_PATH, updatedVersionJs, "utf8");

  const frontPkg = readJson(FRONT_PACKAGE_PATH);
  frontPkg.version = next;
  writeJson(FRONT_PACKAGE_PATH, frontPkg);

  const backPkg = readJson(BACK_PACKAGE_PATH);
  backPkg.version = next;
  writeJson(BACK_PACKAGE_PATH, backPkg);

  for (const lockPath of [FRONT_LOCK_PATH, BACK_LOCK_PATH]) {
    if (!fs.existsSync(lockPath)) continue;
    const lockRaw = fs.readFileSync(lockPath, "utf8");
    const lockNext = bumpPackageLockVersion(lockRaw, current, next);
    if (lockNext !== lockRaw) fs.writeFileSync(lockPath, lockNext, "utf8");
  }

  if (fs.existsSync(BACK_SERVER_PATH)) {
    const srvRaw = fs.readFileSync(BACK_SERVER_PATH, "utf8");
    const srvNext = updateServerHealthVersion(srvRaw, next);
    if (srvNext !== srvRaw) fs.writeFileSync(BACK_SERVER_PATH, srvNext, "utf8");
  }

  console.log(`[version] CO-CEO atualizado: v-${current} -> v-${next}`);
}

try {
  main();
} catch (e) {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
}

