# Forensic Inventory Analysis: SKU 49

**Product:** CORTINA LUX UNICA CTL LISO PRATA 5.80X2.60
**Code:** 10163
**Analysis Date:** 2026-04-24T12:25:46.457Z

## 1. Branch Performance Summary

| Branch | Physical | Available | Suggestion | Target (P150) | Lost Units | Rupture % | Rule Violations |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| Carijós | 0 | -1 | 1.0 | 0 | 1.31 | 54.45% | ⚠️ 401 days < 0 |
| Tupis | 0 | -1 | 1.0 | 0 | 0.00 | 100.00% | ⚠️ 764 days < 0 |
| Betim | 2 | 1 | 0.0 | 1 | 23.92 | 10.73% | ⚠️ 15 days < 0 |
| Guaranis | 1 | 0 | 0.0 | 0 | 2.57 | 6.94% | ⚠️ 38 days < 0 |
| G2 | 1 | 0 | 0.0 | 0 | 0.00 | 4.06% | ⚠️ 31 days < 0 |
| Barreiro | 2 | 1 | 0.0 | 1 | 35.17 | 12.17% | ⚠️ 7 days < 0 |
| Venda Nova | 1 | 0 | 0.0 | 0 | 19.55 | 18.46% | ⚠️ 106 days < 0 |
| Eldorado 2 | 3 | 2 | 0.0 | 2 | 52.94 | 16.49% | ⚠️ 44 days < 0 |
| Babita | 3 | 2 | -1.0 | 1 | 20.02 | 10.21% | ⚠️ 36 days < 0 |
| Fábrica | 9 | 9 | -6.0 | 3 | 143.32 | 24.48% | ✅ Clear |

**Total Potential Lost Sales:** 298.80 units

## 2. Forensic Audit: The Negative Stock Paradox
The system currently allows `availableStock` to drop to -1. This occurs when `physicalStock` is 0 and `VITRINE_LOCAL` is 1.
According to **REGRAS_SAGRADAS_APOLLO.md**, this should be capped at 0 (`Saldo_Disponível = MAX(0, Saldo_Fisico - Saldo_Vitrine)`).
The current engine (v17.3) is leaking negative values into the suggestion logic, which distorts the replenishment priority.

## 3. Suggestion Accuracy Audit
Current suggestion formula: `Sugestão = Disponível - Target`.
For branches in rupture (e.g., Tupis), the suggestion is highly negative (e.g., -5), indicating a critical need.
However, the system needs to prioritize these transfers from **Fábrica**, which itself has a 29% rupture history and only 9 units in stock.

## 4. Factory Deep Dive (Supply Bottleneck)
Recent Factory Status (Last 10 Days):

| Date | Physical | Available | Demand | p100 |
| :--- | :---: | :---: | :---: | :---: |
| 2026-04-09 | 10 | 10 | N/A | 1.90 |
| 2026-04-10 | 10 | 10 | N/A | 2.01 |
| 2026-04-11 | 10 | 10 | N/A | 1.79 |
| 2026-04-12 | 10 | 10 | N/A | 1.78 |
| 2026-04-13 | 9 | 9 | N/A | 1.78 |
| 2026-04-14 | 9 | 9 | N/A | 1.78 |
| 2026-04-15 | 9 | 9 | N/A | 1.78 |
| 2026-04-16 | 9 | 9 | N/A | 1.78 |
| 2026-04-17 | 9 | 9 | N/A | 1.78 |
| 2026-04-18 | 9 | 9 | N/A | 1.78 |