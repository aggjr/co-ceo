# Pendências — STOCKSPIN / Apollo (próximos passos)

Lista consolidada do que ficou explícito para tratar em breve. Ordem não é prioridade rígida.

---

## Nível loja (produto / operação)

1. **Confiabilidade de dados por loja**  
   Detector de anomalias (saldo impossível, vendas vs estoque, saltos inexplicáveis), com **score de confiança** por SKU×loja.

2. **Política operacional por criticidade**  
   Regras diferenciadas por classe (A/B/C, margem, giro, essencialidade), não um único comportamento para todos os SKUs.

3. **Calendário e sazonalidade local**  
   Dia da semana, feriados, promoções e eventos da loja impactando consumo e limites.

4. **Camada de execução da recomendação**  
   Fila “o que fazer hoje” por loja: prioridade, quantidade, impacto esperado e **confirmação de execução** (closed-loop).

5. **Pós-ação e aprendizagem**  
   Medir se a recomendação evitou ruptura/excesso e **recalibrar** parâmetros (LT, suavização, segurança) com feedback.

6. **Auditoria exportável de LT**  
   CSV/planilha: loja, `LT_mean`, `LT_sigma`, `LT_effective`, amostras, contagens transferência estruturada vs ad hoc.

7. **Calibragem classificação transferência**  
   Ajustar thresholds (`N` lojas no mesmo dia, volume mínimo, janela de rota) com dados reais SARON.

8. **Histórico estoque mínimo legado**  
   Snapshot atual só tinha valores 3 e 5; buscar outra fonte se precisar granularidade real.

9. **Escalação**  
   Replicar piloto (matemática + UI) para **todos os SKUs × todas as lojas** e geração em lote de sugestão de ressuprimento.

---

## CD / Fábrica (visão consolidada)

10. **Visão CD/Fábrica no mesmo gráfico do piloto**  
    Usar timeline `Fábrica` (ou chave equivalente no bundle) como **estoque consolidado CD**, separado da lógica de loja.

11. **Motor CD específico**  
    Regras próprias CD (diferente de loja): em definição; não misturar com inferência de LT de loja.

---

## Comercial / posicionamento (referência)

12. **Canibalização de margem / portfólio**  
    Alertas quando novo SKU reduz throughput global do core (caso SARON como narrativa + regra de produto).

---

*Última atualização: alinhamento com conversa sobre maturidade do cliente, LT real, transferências estruturadas vs ad hoc, e preço por loja.*
