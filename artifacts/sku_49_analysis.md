# Inventory Analysis Report: SKU 49

**Product:** CORTINA LUX UNICA CTL LISO PRATA 5.80X2.60
**Code:** 10163
**Data Timestamp:** 2026-04-23T01:43:58.677Z

## Summary by Branch

| Branch | Current Physical | Current Available | Rupture Rate (Metric) | Calc Rupture Rate (Historical) | Total Sales | Lost Units | Neg Avail Days |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Carijós | 0 | -1 | 54.45% | 52.49% | 13 | 1.31 | 401 |
| Tupis | 0 | -1 | 100.00% | 100.00% | 17 | 0.00 | 764 |
| Betim | 2 | 1 | 10.73% | 1.96% | 23 | 23.92 | 15 |
| Guaranis | 1 | 0 | 6.94% | 4.97% | 9 | 2.57 | 38 |
| G2 | 1 | 0 | 4.06% | 4.06% | 12 | 0.00 | 31 |
| Barreiro | 2 | 1 | 12.17% | 0.92% | 37 | 35.17 | 7 |
| Venda Nova | 1 | 0 | 18.46% | 13.87% | 34 | 19.55 | 106 |
| Eldorado 2 | 3 | 2 | 16.49% | 5.76% | 62 | 52.94 | 44 |
| Babita | 3 | 2 | 10.21% | 4.71% | 26 | 20.02 | 36 |
| Fábrica | 9 | 9 | 24.48% | 29.84% | 230 | 143.32 | 0 |

## Insights & Observations

1. **Total Lost Sales:** Across all branches, approximately **298.80 units** were potentially lost due to stockouts.
2. **Critical Branch:** **Fábrica** has the highest potential loss with **143.32 units**.
3. **Negative Available Stock:** This occurs frequently (e.g., Carijós has 154 days). A manual audit of the data shows that negative available stock (-1) almost always coincides with 0 physical stock and a sale event, suggesting that the system logs sales even when physical stock is not yet updated or allowing "overselling" before a transfer arrives.
4. **Replenishment Need:** Most branches show a high rupture rate (Historical vs Metric). The "estoqueSugestao" (Suggestion Stock) for several branches is 1, even though they are currently at 0 physical stock.
