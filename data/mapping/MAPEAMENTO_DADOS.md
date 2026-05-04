# Mapeamento de dados (legado → analítico → bundles → app)

Este documento é a referência humana para alinhar **MySQL legado**, **schema `ceo`**, **artefatos JSON/JS** na pasta `data/` e **base da app** `co_ceo_db`. O contrato máquina-legível das chaves JSON está em **`canonical_keys.json`** na mesma pasta.

---

## 1. Três bases lógicas

| Camada | Onde vive | Função |
|--------|-----------|--------|
| **Legado** | MySQL STOCKSPIN (`LEGACY_MYSQL_*` no `.env` da raiz `c:\co_ceo`) | Fonte operacional: produtos, categorias, movimentações, ativos, unidades, sugestões CD, etc. |
| **CEO (analítico)** | MySQL schema normalmente `ceo` (`CEO_MYSQL_*` ou fallback `LOCAL_MYSQL_*`) | Snapshots diários, curvas, agregados CD, bundles consumidos pelos scripts Node. |
| **CO-CEO app** | MySQL `co_ceo_db` (credenciais em `coceo_software_template/backend/.env`: `DB_*`) | Tenants, usuários, RBAC, faturação; seed padrão com **Cliente demonstração** (`id=1`, `slug=demo`) e **SARON CORTINAS** (`id=2`, `slug=saron-cortinas`). |

**Regra de ouro:** o valor de **`LEGACY_MYSQL_DATABASE`** no `.env` da raiz deve ser o mesmo schema que os scripts consultam (`assertLegacyConfig()`). Opcionalmente, preencha **`tenants.legacy_db_name`** na linha da SARON (`id=2`) com esse mesmo nome para documentação e auditoria na app — ver `init_co_ceo_db.sql` e migração `004_tenant_legacy_db_name.sql`.

---

## 2. Variáveis de ambiente (sem duplicar segredos)

- **Legado:** `LEGACY_MYSQL_HOST`, `LEGACY_MYSQL_USER`, `LEGACY_MYSQL_PASSWORD`, `LEGACY_MYSQL_DATABASE` (+ opcionais SSL/porta). Ver `.env.example` na raiz.
- **CEO:** `CEO_MYSQL_*` ou, em alternativa, os mesmos `LOCAL_MYSQL_*` usados por outros scripts.
- **App:** `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` no backend do template.

**Superusuário e “entrar como cliente”:** em produto costuma chamar-se **personificação de tenant** (ingl. *tenant impersonation*). No CO-CEO, o superusuário escolhe o cliente no cabeçalho do cockpit; o front grava `currentTenantId` no `localStorage` e envia o cabeçalho **`x-tenant-id`** nas chamadas à API (`apiHelpers.js`), e o backend (`auth.js` → `authTenant`) aplica o contexto daquele tenant.

O arquivo **`database_mapper.js`** lê apenas o legado via **`coceo_db_config.js`** — **não** deve conter hosts, usuários ou senhas fixos no código.

---

## 3. Pipeline até o plano CD (resumo)

1. **`data/client/network_matrix.json`** — matriz SKU × loja (demanda `sugestao_unidades`, ruptura, prioridade, etc.). Gerado por `npm run build:client-matrix`.
2. **`data/catalog_grid.js`** — grade de catálogo por `code` (categoria/subcategoria); fallback quando o legado não classifica o SKU.
3. **`scripts/build_cd_purchase_plan.js`** (`npm run build:cd-plan`):
   - Lê a matrix + catálogo.
   - **Legado:** categorias (`produto`, `produtocategoria`, `categoria`), sugestões CD/fábrica, métricas de vendas por janela.
   - **CEO:** metadados de datas (`daily_stock_snapshot`, `cd_daily_aggregate`); bundles SKU em `data/js` para estado CD/fábrica (`computeCdFactoryStatus`).
   - Escreve **`data/client/cd_purchase_plan.json`** e **`cd_purchase_plan.js`** (`window.CD_PURCHASE_PLAN_DATA`).

Chaves exatas de cada objeto: ver **`canonical_keys.json`**.

---

## 4. Schema `ceo` (migrações SQL)

Arquivos em `sql/ceo/`:

- `001_init_schema.sql` — `engine_run`, `daily_stock_snapshot`, `learned_parameter`, `replenishment_suggestion`
- `002_cd_daily_aggregate.sql` — `cd_daily_aggregate`
- `003_operational_decision_layer.sql` — `source_sync_state`, `recalc_request`, `stock_curve_daily`, `sku_store_daily_finance`, `stock_health_daily`, `top_product_daily_snapshot`

**Nota multi-tenant:** as tabelas `ceo` listadas não incluem `tenant_id`. Um ambiente = um cliente analítico; para vários clientes no mesmo servidor MySQL seria necessário evolução de schema ou bases separadas.

---

## 5. Schema `co_ceo_db` (app)

- **`coceo_software_template/database/init_co_ceo_db.sql`** — cria DB, tabelas e seed (tenant id=1 demo + id=2 SARON).
- **`coceo_software_template/database/patch_seed_two_tenants_demo_saron.sql`** — bases antigas com SARON só em id=1 passam a ter demo + SARON como no seed atual.
- **`coceo_software_template/database/patch_insert_saron_tenant_complete.sql`** — quando só existe o cliente de teste: insere/atualiza **SARON CORTINAS** (`id=2`), `legacy_db_name = stockspin_core_db_saron` (alinhar ao `LEGACY_MYSQL_DATABASE` do `.env`), assinatura e usuário `admin@saroncortinas.com.br`.
- **`coceo_software_template/database/patch_tenant_saron_cortinas.sql`** — alinha nome/contato da SARON (`id=2`).
- **`coceo_software_template/database/migrations/004_tenant_legacy_db_name.sql`** — adiciona coluna `tenants.legacy_db_name` em instalações **já** criadas antes desta coluna (em installs novos a coluna já vem no `init`).

---

## 6. Relatório automático do legado

```bash
npm run map:legacy-schema
```

Gera **`data/mapping/schema_report_legacy.generated.md`** (lista `DESCRIBE` de todas as tabelas). O arquivo está no `.gitignore` para evitar diffs enormes e dados específicos de ambiente; gere-o localmente quando precisar da documentação manual do schema.

---

## 7. Outros artefatos

- **`data/js/*.js`** — bundles por SKU (CEO); usados por `build_cd_purchase_plan.js` e verificadores de cobertura.
- **`coceo_der_operacao_dados.html`** — visão DER / operação para humanos.
- Scripts adicionais (`build_stock_health_histogram.js`, `build_legacy_ops_mapping.js`, etc.) — cada um documenta suas fontes no cabeçalho do arquivo; alinhe com este mapeamento ao adicionar campos novos.

---

## 8. Checklist anti-erro

- [ ] `.env` na raiz com `LEGACY_MYSQL_*` completo e testável.
- [ ] `CEO_MYSQL_*` ou `LOCAL_MYSQL_*` apontando ao schema `ceo` populado.
- [ ] `network_matrix.json` atualizado antes de `build:cd-plan`.
- [ ] `tenants.legacy_db_name` (opcional) = `LEGACY_MYSQL_DATABASE` para o tenant correto.
- [ ] Front/stockspin a consumir apenas chaves listadas em **`canonical_keys.json`** ao estender o modelo.

---

## 9. SARON CORTINAS — cliente real e ligação diária ao legado

No cenário atual de implantação, **todo o conteúdo operacional puxado do sistema legado** corresponde ao tenant **SARON CORTINAS** (`id = 2`, `slug = saron-cortinas`). O cliente **demonstração** (`id = 1`) existe para testes da app e não usa o legado de produção. O `.env` na raiz (`LEGACY_MYSQL_*`) deve apontar para o schema MySQL da SARON — não misture outros clientes no mesmo legado em um único schema.

**Usuário inicial da SARON (administrador do tenant):** `admin@saroncortinas.com.br`, senha inicial `12345678`. Troque a senha no primeiro login. O seed está em `coceo_software_template/database/init_co_ceo_db.sql`; bases antigas podem aplicar `database/patch_saron_admin_user.sql`.

**Atualização diária “do dia anterior” na prática:** os scripts Node consultam o MySQL legado **ao vivo** (movimentações e cadastros já refletem o que foi lançado até o momento da execução). Para uma rotina matinal que **recalcule tudo** com base no estado atual do legado:

- **`npm run job:daily-from-legacy`** — executa `sync:apollo-full` (catálogo + miner + motor Apollo + grade + matriz de rede) em seguida `build:network-demands` e `build:cd-plan`.
- **`npm run job:daily-9am`** — mais rápido: só regenera matriz, demandas e plano CD **assumindo** que os bundles em `data/js` já estão atualizados.

Se você mantém uma **cópia local** do schema legado e quer atualizá-la antes do pipeline (opcional): defina `DAILY_REPLICATE_LEGACY=1` no ambiente e rode `npm run job:daily-from-legacy` (chama `replicate:legacy-local` primeiro). Para produção direta contra o servidor legado, normalmente **não** é necessário.

Agendamento Windows: `scripts/Register-CoCeoDaily9amTask.ps1` + `scripts/daily_9am_run.ps1` — altere o comando em `daily_9am_run.ps1` para `job:daily-from-legacy` se quiser o pipeline completo todo dia.
