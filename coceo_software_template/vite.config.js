import { defineConfig, loadEnv } from "vite";
import fs from "node:fs";
import path from "node:path";

/** Caminho padrão da instalação STOCKSPIN espacial (Windows + Google Drive). Sobrescreva com VITE_STOCKSPIN_PHYSICAL_ROOT no .env */
const DEFAULT_STOCKSPIN_PHYSICAL_ROOT =
  "G:\\Meu Drive\\01 - Nova Estrutura\\Trabalhos\\FOCCUS\\Softwares\\STOCKSPIN";

function physicalArchitecturePlugin(physicalRoot) {
  const resolvedRoot = path.resolve(physicalRoot);

  function attach(server) {
    server.middlewares.use((req, res, next) => {
      const rawUrl = req.url.split("?")[0];
      if (!rawUrl.startsWith("/physical-architecture")) return next();

      if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>STOCKSPIN</title></head><body style="font-family:system-ui;padding:2rem;background:#050d1a;color:#f8fafc;">
          <h1 style="color:#dab177;">Pasta do STOCKSPIN não encontrada</h1>
          <p>Defina no <code>.env</code> na pasta do frontend:</p>
          <pre style="background:#0f172a;padding:1rem;border-radius:8px;">VITE_STOCKSPIN_PHYSICAL_ROOT=C:\\\\caminho\\\\para\\\\STOCKSPIN</pre>
          <p>Valor atual resolvido: <code>${resolvedRoot}</code></p>
          </body></html>`
        );
        return;
      }

      const prefix = "/physical-architecture";
      let rel = decodeURIComponent(rawUrl.slice(prefix.length));
      if (rel.startsWith("/")) rel = rel.slice(1);
      if (!rel || rel === "") rel = "index.html";

      let abs = path.join(resolvedRoot, rel);
      try {
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
          abs = path.join(abs, "index.html");
        }
      } catch {
        res.statusCode = 500;
        res.end();
        return;
      }

      const normalizedFile = path.resolve(abs);
      const relToRoot = path.relative(resolvedRoot, normalizedFile);
      if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      if (!fs.existsSync(normalizedFile) || !fs.statSync(normalizedFile).isFile()) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not found: " + rel);
        return;
      }

      const ext = path.extname(normalizedFile).toLowerCase();
      const mime =
        {
          ".html": "text/html; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".mjs": "application/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".ico": "image/x-icon",
          ".woff2": "font/woff2",
          ".woff": "font/woff",
          ".ttf": "font/ttf",
          ".map": "application/json",
        }[ext] || "application/octet-stream";

      res.setHeader("Content-Type", mime);
      fs.createReadStream(normalizedFile).on("error", () => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      }).pipe(res);
    });
  }

  return {
    name: "physical-architecture-static",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}

function mimeForExt(ext) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".ttf": "font/ttf",
      ".map": "application/json",
    }[ext] || "application/octet-stream"
  );
}

/**
 * Em dev/preview, serve ficheiros da raiz do repo (pasta pai de coceo_software_template),
 * ex.: /co-ceo-stockspin-static/data/catalog_grid.js → ../data/catalog_grid.js
 * Assim o Catálogo (Grid) funciona sem depender do :8000 ter o mesmo cwd.
 */
function coCeoRepoStaticPlugin(repoRoot) {
  const mount = "/co-ceo-stockspin-static";

  function attach(server) {
    server.middlewares.use((req, res, next) => {
      const rawUrl = (req.url || "").split("?")[0];
      if (!rawUrl.startsWith(`${mount}/`)) return next();

      let rel = decodeURIComponent(rawUrl.slice(mount.length + 1));
      if (!rel || rel.includes("..")) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      const abs = path.join(repoRoot, rel);
      const normalized = path.resolve(abs);
      const relToRoot = path.relative(repoRoot, normalized);
      if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not found: " + rel);
        return;
      }

      const ext = path.extname(normalized).toLowerCase();
      res.setHeader("Content-Type", mimeForExt(ext));
      fs.createReadStream(normalized)
        .on("error", () => {
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        })
        .pipe(res);
    });
  }

  return {
    name: "co-ceo-repo-stockspin-static",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const physicalRoot = env.VITE_STOCKSPIN_PHYSICAL_ROOT || DEFAULT_STOCKSPIN_PHYSICAL_ROOT;
  const repoRoot = path.resolve(__dirname, "..");

  return {
    plugins: [physicalArchitecturePlugin(physicalRoot), coCeoRepoStaticPlugin(repoRoot)],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
        "/uploads": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
    },
  };
});
