import "./style.css";
import "./styles/excel-table.css";
import "./modules/stockspin/stockspin-excel.css";
import { Login } from "./components/Login.js";
import { Dialogs } from "./components/Dialogs.js";
import { Header } from "./components/Header.js";
import { getVersion } from "./utils/version.js";
import { STOCKSPIN_SCREENS } from "./modules/stockspin/screens.js";
import {
  getActiveTenantIdForModules,
  getAllowedStockspinScreens,
  getPhysicalArchitectureIndexUrl,
  getStockspinStaticBaseUrl,
} from "./utils/moduleContext.js";

Dialogs.init();

localStorage.removeItem("token");
localStorage.removeItem("user");
localStorage.removeItem("projects");
localStorage.removeItem("currentProject");

const app = document.querySelector("#app");

function renderLogin() {
  app.innerHTML = "";
  app.appendChild(
    Login(() => {
      renderDashboard();
    })
  );
}

function stockspinMenuHtml() {
  const allowed = getAllowedStockspinScreens();
  const visible = allowed
    ? STOCKSPIN_SCREENS.filter((s) => allowed.has(s.id))
    : STOCKSPIN_SCREENS;
  return visible
    .map((s) => `<li><a href="#" data-screen="${s.id}">${s.icon} ${s.label}</a></li>`)
    .join("");
}

function renderDashboard() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const canAccessCockpit = Boolean(user && user.isSuperUser);

  app.innerHTML = "";
  app.className = "dashboard-container";
  app.style.display = "flex";
  app.style.flexDirection = "row";
  app.style.height = "100vh";
  app.style.overflow = "hidden";

  const nav = document.createElement("nav");
  nav.className = "dashboard-nav";
  nav.innerHTML = `
    <div class="nav-header">
      <h1 class="nav-logo">CO-CEO</h1>
    </div>
    <ul class="nav-menu">
      ${
        canAccessCockpit
          ? `<li class="nav-menu-item">
        <a href="#" class="nav-menu-toggle" data-toggle="cockpit">
          🎛️ Cockpit
          <span class="nav-menu-arrow">▼</span>
        </a>
        <ul class="nav-submenu active" id="submenu-cockpit">
          <li><a href="#" data-screen="tenants">🏢 Clientes</a></li>
          <li><a href="#" data-screen="users">👥 Usuários</a></li>
          <li><a href="#" data-screen="roles">🎭 Papéis</a></li>
          <li><a href="#" data-screen="home" class="active">📊 Dashboard</a></li>
        </ul>
      </li>`
          : ""
      }
      <li class="nav-menu-item">
        <a href="#" class="nav-menu-toggle" data-toggle="stockspin">
          📦 STOCKSPIN
          <span class="nav-menu-arrow">▶</span>
        </a>
        <ul class="nav-submenu" id="submenu-stockspin">
          ${stockspinMenuHtml()}
        </ul>
      </li>
    </ul>
    <div class="nav-footer">
      <button class="nav-logout" id="sidebar-logout" style="width: 100%;">🚪 Sair</button>
      <div class="sidebar-version" style="color: rgba(255,255,255,0.3); font-size: 0.62rem; text-align: center; margin-top: 0.35rem;">
        ${getVersion()}
      </div>
    </div>
  `;
  app.appendChild(nav);
  nav.querySelector("#sidebar-logout").onclick = () => location.reload();

  const rightColumn = document.createElement("div");
  rightColumn.style.display = "flex";
  rightColumn.style.flexDirection = "column";
  rightColumn.style.flex = "1";
  rightColumn.style.minWidth = "0";
  rightColumn.style.overflow = "hidden";
  app.appendChild(rightColumn);

  if (user.isSuperUser) {
    const header = Header(user, null);
    rightColumn.appendChild(header);
  }

  const main = document.createElement("main");
  main.className = "dashboard-main dashboard-main--cockpit";
  main.id = "dashboard-main";
  main.style.flex = "1";
  main.style.overflowY = "auto";
  main.style.padding = "2rem";
  main.innerHTML = `
    <div class="welcome-screen">
      <h1 class="welcome-title">Bem-vindo ao CO-CEO</h1>
      <p class="welcome-sub">Plataforma de apoio constante à tomada de decisão que muda o futuro da sua empresa</p>
    </div>
  `;
  rightColumn.appendChild(main);

  setupNavigation();
}

function setupNavigation() {
  import("./screens/TenantManager.js").then(({ TenantManager }) => (window.TenantManager = TenantManager));
  import("./screens/UserManager.js").then(({ UserManager }) => (window.UserManager = UserManager));
  import("./screens/RoleManager.js").then(({ RoleManager }) => (window.RoleManager = RoleManager));

  document.querySelectorAll(".nav-menu-toggle").forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      const submenu = document.getElementById("submenu-" + toggle.getAttribute("data-toggle"));
      const arrow = toggle.querySelector(".nav-menu-arrow");
      if (!submenu) return;
      submenu.classList.toggle("active");
      arrow.textContent = submenu.classList.contains("active") ? "▼" : "▶";
    });
  });

  document.querySelectorAll("[data-screen]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateToScreen(link.getAttribute("data-screen"));
      document.querySelectorAll(".nav-submenu a").forEach((a) => a.classList.remove("active"));
      if (link.tagName === "A" && link.closest(".nav-submenu")) link.classList.add("active");
    });
  });
}

async function renderStockspinScreen(screenId) {
  const main = document.getElementById("dashboard-main");
  const cfg = STOCKSPIN_SCREENS.find((x) => x.id === screenId);
  if (!cfg) {
    main.innerHTML = `<div style="padding:2rem;color:#c00;">Tela STOCKSPIN não encontrada: ${screenId}</div>`;
    return;
  }
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const allowed = getAllowedStockspinScreens(user);
  if (allowed && !allowed.has(screenId)) {
    main.classList.add("dashboard-main--cockpit");
    main.style.padding = "2rem";
    main.style.display = "";
    main.innerHTML = `
      <div style="max-width:48rem;padding:1.4rem 1.6rem;border:1px solid var(--shell-border-soft);border-radius:12px;background:rgba(4,14,26,.62);">
        <h2 style="margin:0 0 .6rem;color:var(--color-accent);font-size:1.05rem;">Acesso restrito</h2>
        <p style="margin:0;color:var(--shell-fg-muted);line-height:1.55;">
          Este usuário não tem permissão para abrir a tela <strong style="color:var(--shell-fg);">${cfg.label}</strong>.
          Fale com o administrador da conta se precisa deste acesso.
        </p>
      </div>`;
    return;
  }
  const activeTenantId = getActiveTenantIdForModules();
  if (user.isSuperUser && !activeTenantId) {
    main.classList.add("dashboard-main--cockpit");
    main.style.padding = "2rem";
    main.style.display = "";
    main.innerHTML = `
    <div style="max-width:52rem;padding:1.5rem 1.75rem;border:1px solid var(--shell-border-soft);border-radius:12px;background:rgba(4,14,26,.62);">
      <h2 style="margin:0 0 .7rem;color:var(--color-accent);font-size:1.1rem;">Selecione um cliente para ver dados do STOCKSPIN</h2>
      <p style="margin:0;color:var(--shell-fg-muted);line-height:1.55;">
        Você está em visão global (sem personificação). Para evitar mistura de dados entre tenants,
        o módulo STOCKSPIN só exibe conteúdo após escolher um cliente no seletor
        <strong style="color:var(--shell-fg);">"Personificar cliente (contexto do tenant)"</strong>.
      </p>
    </div>`;
    return;
  }
  const baseUrl = getStockspinStaticBaseUrl();

  if (cfg.path === "__PHYSICAL_ARCHITECTURE__") {
    const archSrc = getPhysicalArchitectureIndexUrl();
    main.classList.remove("dashboard-main--cockpit");
    main.style.padding = "0";
    main.style.display = "flex";
    main.style.flexDirection = "column";
    if (!archSrc) {
      main.innerHTML = `
    <div class="stockspin-toolbar">
      <div class="stockspin-toolbar-title">${cfg.icon} ${cfg.label}</div>
      <div class="stockspin-toolbar-src">URL não configurada</div>
    </div>
    <div style="padding:1.5rem 2rem;color:var(--shell-fg);max-width:52rem;line-height:1.55;">
      <p style="margin-bottom:1rem;">Nenhuma URL válida foi encontrada para o iframe. Em desenvolvimento o Vite costuma servir a pasta em <code style="color:var(--color-accent);">/physical-architecture/</code> — confira se a pasta existe e reinicie o <code>npm run dev</code>.</p>
      <ul style="margin-left:1.25rem;margin-bottom:1rem;">
        <li>Caminho da pasta STOCKSPIN no <code>.env</code>: <code style="color:var(--color-accent);">VITE_STOCKSPIN_PHYSICAL_ROOT</code> (padrão no <code>vite.config.js</code> aponta para o Google Drive <code>G:\\…\\STOCKSPIN</code>).</li>
        <li>Ou URL absoluta: <code style="color:var(--color-accent);">VITE_PHYSICAL_ARCHITECTURE_INDEX_URL</code> (ex.: <code>http://127.0.0.1:5500/index.html</code>).</li>
        <li>Ou <code style="color:var(--color-accent);">module_settings.STOCKSPIN.physicalArchitectureIndexUrl</code> no cadastro do cliente.</li>
        <li>Ou no console: <code style="color:var(--color-accent);">localStorage.setItem('physicalArchitectureIndexUrlOverride','…')</code> e recarregue.</li>
      </ul>
      <p style="color:var(--shell-fg-muted);font-size:0.9rem;"><strong>Nota:</strong> o navegador costuma bloquear <code>file://</code> dentro do iframe quando o CO-CEO está em <code>http://</code>. Use o proxy do Vite ou um servidor HTTP.</p>
    </div>`;
      return;
    }
    const safeIframeSrc = String(archSrc).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const safeToolbarText = String(archSrc).replace(/</g, "&lt;");
    main.innerHTML = `
    <div class="stockspin-toolbar">
      <div class="stockspin-toolbar-title">${cfg.icon} ${cfg.label}</div>
      <div class="stockspin-toolbar-src">${safeToolbarText}</div>
    </div>
    <iframe title="${cfg.label}" src="${safeIframeSrc}" style="width:100%;height:100%;border:0;background:#050d1a;flex:1;min-height:0;"></iframe>
  `;
    return;
  }

  const src = `${baseUrl}${cfg.path}`;
  main.classList.remove("dashboard-main--cockpit");
  main.style.padding = "0";

  if (cfg.excelView) {
    main.style.display = "flex";
    main.style.flexDirection = "column";
    main.innerHTML = `
    <div class="stockspin-toolbar">
      <div class="stockspin-toolbar-title">${cfg.icon} ${cfg.label}</div>
      <div class="stockspin-toolbar-src">ExcelTable · dados: ${baseUrl}</div>
    </div>
    <div id="stockspin-view-host" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;"></div>
  `;
    const host = document.getElementById("stockspin-view-host");
    try {
      if (cfg.excelView === "procurement") {
        const m = await import("./modules/stockspin/views/procurementView.js");
        await m.mount(host);
      } else if (cfg.excelView === "transfer") {
        const m = await import("./modules/stockspin/views/transferEqualizerView.js");
        await m.mount(host);
      } else if (cfg.excelView === "production") {
        const m = await import("./modules/stockspin/views/productionProgrammingView.js");
        await m.mount(host);
      } else if (cfg.excelView === "top") {
        const m = await import("./modules/stockspin/views/topImportantView.js");
        await m.mount(host);
      } else if (cfg.excelView === "catalog") {
        const m = await import("./modules/stockspin/views/catalogGridView.js");
        await m.mount(host);
      } else if (cfg.excelView === "adminCoceoAudit") {
        const m = await import("./modules/stockspin/views/adminCoceoAuditView.js");
        await m.mount(host);
      } else {
        host.innerHTML = `<div style="padding:1rem;color:#f87171;">View STOCKSPIN desconhecida: ${cfg.excelView}</div>`;
      }
    } catch (err) {
      console.error(err);
      host.innerHTML = `<div style="padding:1rem;color:#f87171;">Erro ao carregar dados (verifique o servidor em ${baseUrl} e o console).<br/><small>${String(err.message || err)}</small></div>`;
    }
    return;
  }

  main.style.display = "";
  main.innerHTML = `
    <div class="stockspin-toolbar">
      <div class="stockspin-toolbar-title">${cfg.icon} ${cfg.label}</div>
      <div class="stockspin-toolbar-src">Fonte: ${src}</div>
    </div>
    <iframe title="${cfg.label}" src="${src}" style="width:100%;height:calc(100vh - 140px);border:0;background:#0f172a;flex:1;"></iframe>
  `;
}

function navigateToScreen(screen) {
  const main = document.getElementById("dashboard-main");
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const canAccessCockpit = Boolean(user && user.isSuperUser);
  switch (screen) {
    case "tenants":
      if (!canAccessCockpit) {
        renderStockspinScreen("stockspin-apollo-grid");
        break;
      }
      if (window.TenantManager) {
        main.classList.add("dashboard-main--cockpit");
        main.style.padding = "2rem";
        main.innerHTML = "";
        main.appendChild(window.TenantManager());
      }
      break;
    case "users":
      if (!canAccessCockpit) {
        renderStockspinScreen("stockspin-apollo-grid");
        break;
      }
      if (window.UserManager) {
        main.classList.add("dashboard-main--cockpit");
        main.style.padding = "2rem";
        main.innerHTML = "";
        main.appendChild(window.UserManager());
      }
      break;
    case "roles":
      if (!canAccessCockpit) {
        renderStockspinScreen("stockspin-apollo-grid");
        break;
      }
      if (window.RoleManager) {
        main.classList.add("dashboard-main--cockpit");
        main.style.padding = "2rem";
        main.innerHTML = "";
        main.appendChild(window.RoleManager());
      }
      break;
    case "home":
      if (!canAccessCockpit) {
        renderStockspinScreen("stockspin-apollo-grid");
        break;
      }
      renderDashboard();
      break;
    default:
      if (screen && screen.startsWith("stockspin-")) {
        renderStockspinScreen(screen);
      } else {
        renderDashboard();
      }
  }
}

renderLogin();
