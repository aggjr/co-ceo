# Modelo matemático Co-CEO — Mira robusta e bandas de estoque

Este documento formaliza o modelo implementado em `lib/mira_model.js` e espelhado nas interfaces de curvas (ex.: `mira_center_2y.html`, `model_curves_master.html`). O objetivo é estimar uma **mira diária de cobertura** (P100) a partir de vendas **robustas** a uma janela móvel, e derivar **bandas multiplicativas** usadas como referência de política de estoque.

---

## 1. Dados de entrada

Para uma loja fixa, seja \((d_t)\) a sequência de datas (ISO `YYYY-MM-DD`) ordenada. Em cada dia \(t\) observamos:

- \(a_t\) = `availableStock` (estoque disponível, unidades)
- \(f_t\) = `physicalStock` (estoque físico)
- \(v_t\) = `sales` (vendas no dia, unidades; \(\geq 0\))

No gráfico, “Legado” coincide com \(f_t\) na implementação atual.

---

## 2. Recorte temporal (horizonte de análise)

Parâmetros: horizonte em **anos** \(H\) (padrão \(H=2\)), flag **excluir domingos**.

1. Seja \(d^\*\) a última data da série; define-se a **âncora** \(\tilde d\) como o último dia **não domingo** recuando a partir de \(d^\*\).
2. O intervalo ativo é \([\tilde d - H\text{ anos},\, \tilde d]\).
3. Se excluir domingos: remove-se todo \(t\) cujo dia da semana seja domingo.

O conjunto resultante de dias é a **timeline filtrada** \(\mathcal{T}\), indexada em ordem crescente.

---

## 3. Janela móvel e filtro de ruptura

Parâmetros:

- \(W\) = `windowDays` (dias da janela, ex.: 56)
- \(m\) = mínimo de dias “limpos” (padrão \(m=5\))
- \(p\) = quantil de winsorização superior (padrão \(p=0{,}95\))
- \(LT\) = lead time em **dias** (parâmetro de calibração da reposição)

Para cada índice \(t\) na timeline filtrada, define-se a janela de índices:

\[
J_t = \{\max(0, t-W+1),\, \ldots,\, t\}.
\]

### 3.1 Conjunto “sem ruptura”

Dentro de \(J_t\), considera-se o conjunto de dias \(i\) tais que \(a_i \geq 0\) e \(v_i\) é número válido \(\geq 0\). Denote esse conjunto por \(S_t\).

**Motivação:** quando \(a_i < 0\), a série de vendas observada tende a subestimar a demanda latente; por isso esses pontos **não entram** na média “limpa”.

### 3.2 Fallback

Se \(|S_t| < m\), utiliza-se o conjunto alternativo \(S'_t\) com **todas** as vendas \(v_i \geq 0\) na janela (ainda com winsorização na etapa seguinte). Conta-se quantas vezes o fallback ocorre (`fallbackWindows`) para auditoria.

---

## 4. Winsorização superior

Sobre o conjunto efetivo \(U_t \in \{S_t, S'_t\}\) (não vazio), ordenam-se as vendas e calcula-se o quantil empírico \(Q_{p}\) (implementação por índice em lista ordenada, compatível com o legado do projeto).

Define-se o valor ajustado:

\[
\tilde v_i = \min(v_i,\, Q_{p}).
\]

---

## 5. Média robusta e Mira P100

\[
\mu_t = \frac{1}{|U_t|} \sum_{i \in U_t} \tilde v_i.
\]

A **Mira P100** (unidades de cobertura alvo, interpretação “demanda × LT”) é:

\[
M_t = \mu_t \cdot LT.
\]

Se não houver dados utilizáveis em \(J_t\), define-se \(M_t = \texttt{null}\).

---

## 6. Bandas de política (zonas)

Dado o mapa fixo de multiplicadores \(k\) (objeto `ZONE_K` no código):

| Nome  | \(k\) |
|-------|-------|
| p10   | 0,1   |
| p50   | 0,5   |
| p80   | 0,8   |
| p100  | 1,0   |
| p150  | 1,5   |
| p200  | 2,0   |
| p300  | 3,0   |
| p600  | 6,0   |

Para cada nome \(\ell\) com fator \(k_\ell\):

\[
P^{(\ell)}_t = k_\ell \cdot M_t \quad (\texttt{null} \text{ se } M_t \text{ é } \texttt{null}).
\]

---

## 7. Relação com o motor de rede (Apollo)

O motor **Enterprise** em `apollo_enterprise_engine.js` calcula zonas com outra dinâmica (média móvel de demanda efetiva, regra de 15 dias de ruptura, etc.). A **Mira** deste documento é a camada **Co-CEO** para exploração e calibração \(W, LT\) **alinhada às páginas Mira**. Ambas podem coexistir; não são idênticas bit a bit.

---

## 8. Referência de código

| Artefato | Função |
|----------|--------|
| `lib/mira_model.js` | `filterTimelineChartWindow`, `computeMira100`, `buildZoneCurves`, `runMiraPipeline` |
| `timeline_window.js` | Reexporta o filtro temporal para `pilot_seed_*` / `seed_ceo_*` |
| `scripts/simulate_mira_scenarios.js` | Cenários \((W, LT)\) sobre timeline filtrada |
| `scripts/export_mira_snapshot_all.js` | Exporta métricas agregadas por SKU×loja (lote) |

---

## 9. Extensões possíveis (não obrigatórias)

- Trocar quantil \(p\) ou mínimo \(m\) por família de produto.
- Lead time \(LT\) dependente de fornecedor/canal (por SKU ou tabela externa).
- Inclusão explícita de sazonalidade na estimativa de \(\mu_t\) (harmônicos), como no motor v17.4 — camada separada da Mira linear aqui descrita.
