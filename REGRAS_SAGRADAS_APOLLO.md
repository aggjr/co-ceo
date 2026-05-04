# 📜 PROTOCOLO APOLLO: REGRAS SAGRADAS E IMUTÁVEIS

Este documento contém as premissas inalteráveis do Motor de Inteligência Apollo. Qualquer implementação futura deve respeitar rigorosamente estes critérios.

---

## 1. INTEGRIDADE DE DADOS (FORENSE)
*   **Deduplicação Absoluta:** Vendas e Execuções não podem ser somadas. Usar `doc_origem` para garantir que a demanda não seja inflada.
*   **Marco Zero (Lift):** O estoque histórico nunca pode ser "fantasmagórico" (abaixo de zero). Aplicar o lift para que o ponto mais baixo do histórico estoque o 0 absoluto.

---

## 2. ARQUITETURA DUAL (FINANCEIRO VS. OPERACIONAL)
*   **A Dualidade:** O sistema deve sempre separar o **Estoque Físico** (Capital/ROI) do **Estoque Disponível** (Comando de Reposição).
*   **Cálculo:** `Estoque Disponível = Estoque Físico - Estoque Vitrine`.
*   **Tomada de Decisão:** Toda sugestão de compra e análise de ruptura deve ser feita baseada no **Estoque Disponível**.

---

## 3. MATEMÁTICA E CURVAS ORBITAIS
*   **Modelo:** Sazonalidade Harmônica via Séries de Fourier.
*   **Zonas de Nível (8 níveis definitivos e imutáveis):**

| Nível | Zona | Intervalo | Cor |
|-------|------|-----------|------|
| 1 | ⬛ **RUPTURA**      | < 10% (< p10)       | PRETA     |
| 2 | 🔴 **CRÍTICO**       | 10% a 50% (p10-p50) | VERMELHA  |
| 3 | 🟡 **ABAIXO**        | 50% a 100% (p50-p100) | AMARELA |
| 4 | 🟢 **ACIMA**         | 100% a 150% (p100-p150) | VERDE  |
| 5 | 🔵 **MUITO ACIMA**   | 150% a 200% (p150-p200) | AZUL   |
| 6 | 🟣 **ENCALHADO 1**   | 200% a 400% (p200-p400) | LILÁS  |
| 7 | 🟣 **ENCALHADO 2**   | 400% a 800% (p400-p800) | ROXA   |
| 8 | 🟣 **ENCALHADO 3**   | > 800% (> p800)         | ROXA ESCURA |

*   **Ruptura Crítica:** Um item está em ruptura se `Estoque Disponível < 10% da Mira (p100)`.

---

## 4. STATUS OPERACIONAL (HIERÁRQUICO, INCLUSIVO)
*   Se o estoque está exatamente no limite de uma zona, pertence à zona inferior:
    *   `avail < p10`          → **RUPTURA**
    *   `p10 <= avail < p50`   → **CRÍTICO**
    *   `p50 <= avail < p100`  → **ABAIXO**
    *   `p100 <= avail < p150` → **ACIMA**
    *   `p150 <= avail < p200` → **MUITO ACIMA**
    *   `p200 <= avail < p400` → **ENCALHADO 1**
    *   `p400 <= avail < p800` → **ENCALHADO 2**
    *   `avail >= p800`        → **ENCALHADO 3**

---

## 5. DESIGN E INTERFACE (UI/UX)
*   **Formato de Data:** Sempre `dd/mm/aaaa`.
*   **Cores Oficiais:** 
    *   Estoque Disponível: **Azul Sólido** (Espessura 3.5px).
    *   Estoque Físico: **Cinza Pontilhado**.
    *   Status Cards: Cores dinâmicas (Vermelho, Amarelo, Verde, Azul, Roxo) seguindo a cor da zona.
*   **Visibilidade do Gráfico:**
    *   Eixos X e Y: Linha branca fina (#ffffff).
    *   Labels de Data: Cinza claro, alta visibilidade.
    *   Layout Compacto: Tudo deve ser visível em uma única tela (Sem scroll).

---

**ESTE DOCUMENTO É A FONTE DA VERDADE. NÃO SERÃO ACEITOS DESVIOS DESTAS REGRAS.**
