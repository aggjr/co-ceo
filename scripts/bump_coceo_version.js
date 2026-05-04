"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VERSION_JS_PATH = path.join(ROOT, "coceo_software_template", "src", "utils", "version.js");
const FRONT_PACKAGE_PATH = path.join(ROOT, "coceo_software_template", "package.json");
const BACK_PACKAGE_PATH = path.join(ROOT, "coceo_software_template", "backend", "package.json");

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

  console.log(`[version] CO-CEO atualizado: v-${current} -> v-${next}`);
}

try {
  main();
} catch (e) {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
}

