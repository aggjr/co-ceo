export const STOCKSPIN_SCREENS = [
  {
    id: "stockspin-apollo-grid",
    label: "Mix de Produtos",
    icon: "📦",
    path: "/apollo_grid.html",
    excelView: "catalog"
  },
  {
    id: "stockspin-transfer",
    label: "Transferências",
    icon: "🚚",
    path: "/transfer_cd_equalizer.html",
    excelView: "transfer"
  },
  {
    id: "stockspin-production-program",
    label: "Programação de produção",
    icon: "⚙️",
    path: "/production_programming.html",
    excelView: "production"
  },
  { id: "stockspin-cd-plan", label: "Plano CD", icon: "🗓️", path: "/cd_purchase_plan.html" },
  { id: "stockspin-arch-stores", label: "Arquitetura Lojas", icon: "🏬", path: "/global_network_view.html" },
  { id: "stockspin-arch-cd", label: "Arquitetura CD", icon: "🏢", path: "/cd_production_divergence.html" },
  { id: "stockspin-arch-factory", label: "Arquitetura Fábrica", icon: "🏭", path: "/fábrica_view.html" },
  {
    id: "stockspin-arch-physical",
    label: "Arquitetura Física",
    icon: "📐",
    path: "__PHYSICAL_ARCHITECTURE__",
  },
  /** Telas com tabela: usam ExcelTable in-app (demais continuam em iframe). */
  {
    id: "stockspin-buy-make",
    label: "Compra x Produção",
    icon: "🏭",
    path: "/decision_procurement_production.html",
    excelView: "procurement"
  },
  {
    id: "stockspin-transfer-matrix",
    label: "Mapeamento Transfer (Matriz)",
    icon: "🧮",
    path: "/apollo_redistribution_matrix.html"
  },
  { id: "stockspin-health", label: "Saúde do Estoque", icon: "📈", path: "/stock_health_histogram.html" },
  {
    id: "stockspin-top",
    label: "Top Produtos",
    icon: "⭐",
    path: "/top_important_skus.html",
    excelView: "top"
  },
  {
    id: "stockspin-admin-coceo-audit",
    label: "Divergências ADMIN × CO-CEO",
    icon: "🧾",
    path: "__INTERNAL_ADMIN_COCEO_AUDIT__",
    excelView: "adminCoceoAudit"
  }
];

