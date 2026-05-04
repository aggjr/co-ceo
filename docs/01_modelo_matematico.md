# Definições do projeto — Parte 1: modelo matemático

Este documento fixa o **modelo matemático base** usado na análise de estoque e no comando de reposição. Complementa `principles_and_logic.md` e `REGRAS_SAGRADAS_APOLLO.md` (regras imutáveis de dados e zonas).

---

## 1. Precificação é necessária?

**Para o núcleo operacional de estoque (unidades, prazos, buffers, zonas relativas à “mira”): em geral, não.**

- O que o modelo precisa, primariamente, é **movimento no tempo em unidades** (vendas/execuções reconciliadas, consumo, transferências) e **estoque** (físico e disponível), além de **lead time** e parâmetros de serviço quando existirem.
- **Preço, margem e custo** entram quando a decisão é **financeira** ou de **priorização por valor** (capital empatado em R\$, curva ABC por faturamento, markdown planejado, elasticidade explícita, otimização de mix por contribuição). Isso é camada opcional de **economia da decisão**, não da **física do estoque**.

**Sobre promoções:** o efeito típico de promoção já aparece como **mudança de velocidade** na série de demanda (picos de unidades). Modelos baseados em consumo real e em estatísticas robustas (ou janelas que diluem eventos pontuais) **não exigem** tabela de preço para “enxergar” o pico. Informação explícita de promoção (calendário/flag) **melhora** o forecast e evita que um pico seja tratado como novo patamar — mas é refinamento, não pré-requisito para a lógica de estoque em unidades.

**Resumo:** precificação **não é necessária** para a análise de estoque nas equações “físicas” (disponibilidade, cobertura, bandas, sazonalidade em unidades). Ela só se torna necessária quando o objetivo explícito inclui **valor monetário** ou **trade-off de investimento**.

---

## 2. Variáveis e convenções

| Símbolo | Significado |
|--------|-------------|
| \(t\) | Tempo (dia, semana, etc.; granularidade fixada no pipeline). |
| \(I^{phys}(t)\) | Estoque físico (unidades). |
| \(I^{show}\) | Estoque de vitrine / não prontamente vendável (unidades). |
| \(I^{avail}(t)\) | **Estoque disponível** para decisão operacional: \(\max(0,\, I^{phys}(t) - I^{show})\). |
| \(D(t)\) | Demanda (ou consumo) **reconciliada** no período \(t\) (unidades). |
| \(L\) | Lead time de reposição (mesma unidade de tempo que \(t\)). |

Toda sugestão de compra e leitura de ruptura deve usar \(I^{avail}\), alinhado às regras do projeto.

---

## 3. Demanda e sazonalidade

- **Sinal principal:** séries \(D(t)\) limpas (sem dupla contagem venda/execução; ver protocolo forense).
- **Sazonalidade (Apollo):** componente harmônico (Fourier) pode decompor \(D(t)\) em tendência + ciclos, quando o arquétipo do produto justificar (ver `principles_and_logic.md`).

Representação genérica (conceitual):

\[
D(t) = T(t) + S(t) + \varepsilon(t)
\]

onde \(T\) é tendência, \(S\) sazonalidade (incl. harmônicos) e \(\varepsilon\) ruído. A escolha de granularidade e suavização é parâmetro de engenharia, não altera a necessidade (ou não) de preço.

---

## 4. “Mira” e zonas orbitais (percentis)

O estado do item–loja é classificado comparando **estoque disponível** a uma **mira** (referência de nível desejado / curva histórica), expressa em **percentis** da distribuição de referência (ex.: \(p_{10}, p_{50}, p_{100}, \ldots\)).

- **Ruptura crítica (regra do projeto):** \(I^{avail} < p_{10}\) (zona 1 nas definições oficiais de níveis).
- Demais faixas seguem a tabela hierárquica em `REGRAS_SAGRADAS_APOLLO.md` (limites inclusivos conforme o protocolo).

A “mira” em \(p_{100}\) ancora a escala relativa: comparações são **adimensionais em termos de política de estoque** (posição vs curva), não em R\$.

---

## 5. Cobertura e ponto de pedido (visão clássica compatível com TOC)

Para referência teórica (implementação pode usar variantes TOC/S-DBR):

- **Cobertura alvo** (em dias de demanda esperada):

\[
\text{cobertura}(t) = \frac{I^{avail}(t)}{\bar{D}_{L}}
\]

onde \(\bar{D}_{L}\) é demanda média esperada por período ao longo do horizonte relevante (ex. média móvel ou média condicionada ao modelo sazonal).

- **Ponto de pedido** (unidades), quando se adota política min–max clássica:

\[
ROP = L \cdot \bar{D} + SS
\]

\(SS\) = estoque de segurança (pode derivar de variabilidade de demanda e/ou de lead time). **Nenhum termo exige preço**; apenas distribuição de \(D\) e de \(L\) em unidades/tempo.

---

## 6. Entradas mínimas vs opcionais

| Entrada | Necessária para núcleo operacional? |
|--------|-------------------------------------|
| Estoque físico / movimentos | Sim |
| Vitrine / não vendável | Sim (onde aplicável) |
| Demanda reconciliada | Sim |
| Lead time | Sim (direta ou inferida) |
| Calendário de promoções | Não (recomendado) |
| Preço / custo / margem | Não (exceto camadas financeiras / ABC por valor) |

---

## 7. Próximos documentos sugeridos (definições do projeto)

- Parte 2: dicionário de dados e contratos de ingestão.
- Parte 3: arquétipos de demanda e regras de modelo por arquétipo.
- Parte 4: política de decisão (sugestão de compra, transferência, priorização).

---

*Versão inicial alinhada ao estado atual dos documentos em `C:\co_ceo`.*
