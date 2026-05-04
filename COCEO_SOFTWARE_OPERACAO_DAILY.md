# CO-CEO Daily Software Blueprint

## Objetivo

Operar o CO-CEO diariamente com processamento incremental:

- recalcular **apenas ontem** em operação normal;
- em ajustes retroativos no legado, recalcular **somente da data afetada para frente**;
- manter histórico materializado para curvas, saúde de estoque, rentabilidade e top produtos.

## Base de dados adicionada

Nova migration: `sql/ceo/003_operational_decision_layer.sql`

Tabelas principais:

- `source_sync_state`: watermark por origem.
- `recalc_request`: fila de recálculo parcial por janela.
- `stock_curve_daily`: curvas e faixas por SKU x loja x dia (materializado).
- `sku_store_daily_finance`: preço/custo aplicado, margem, capital de estoque.
- `stock_health_daily`: evolução da saúde por status ao longo do tempo.
- `top_product_daily_snapshot`: ranking diário Top 30 e Top 100 (diretoria).

## Estratégia incremental (proposta)

1. Ler `source_sync_state` de cada fonte legado.
2. Detectar `source_max_ref_date` e `source_max_ts` atual.
3. Definir janela:
   - default: `[ontem, ontem]`;
   - se houver mudança retroativa: `[min_data_alterada, hoje]`.
4. Persistir/atualizar em `recalc_request`.
5. Reprocessar somente a janela:
   - `stock_curve_daily`
   - `sku_store_daily_finance`
   - `stock_health_daily`
   - `top_product_daily_snapshot`
6. Atualizar `source_sync_state` ao final com sucesso.

## Jobs diários (alvo de produção)

1. `sync:apollo-full` (ou pipeline equivalente)
2. ingestão analítica no schema `ceo`
3. materialização incremental (novas tabelas)
4. geração dos datasets de telas
5. checagens de consistência e SLA

## Relatórios estratégicos já previstos na estrutura

- Evolução de disponibilidade Top 30 / Top 100 (diretoria).
- Evolução de margem e ROI por SKU e loja.
- Evolução da saúde de estoque por faixa/status.
- Produtos mais rentáveis por período.
- Base para transferência e reposição abaixo de P150.

## Próximas implementações (fase 1)

1. Job `scripts/materialize_daily_decision_layer.js` para preencher as novas tabelas.
2. Job `scripts/detect_legacy_retroactive_changes.js` para abrir `recalc_request` automaticamente.
3. Rotina de fechamento diário com `engine_run` + telemetria de volume/tempo.
4. API de leitura para telas gerenciais em cima do schema `ceo`.

