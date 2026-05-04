# Princípios e Lógica: STOCKSPIN v2 / Co-CEO

Este documento consolida os conceitos fundamentais, regras de negócio e visão estratégica para a nova geração do ecossistema de inteligência de supply chain.

## 1. O Problema das Classificações Dinâmicas
O status de um estoque (Bom, Ruim, Ruptura, Encalhe) é dependente do contexto e do arquétipo do produto.

### Arquétipos de Demanda
- **Moda**: Explosão exponencial seguida de queda rápida. Foco: Detecção de saturação e interrupção agressiva de compras.
- **Sazonal Anual**: Picos em épocas fixas (Picolé, Cobertor). Distinguir entre **Alta Intensidade** (Binário: 1 ou 0) e **Baixa Intensidade** (Estável com pico).
- **Sazonal Intra-semanal**: Oscilações curtas dentro da semana (Cerveja, Carne).
- **Hard Deadlines (Eventos)**: Produtos com "data de validade comercial" rígida (Ovos de Páscoa, Natal). O buffer deve ser drenado agressivamente conforme o evento se aproxima.
- **Bens Duráveis**: Ciclos longos e reposição estável.

## 2. O Valor de Retenção (Core SARON)
O que torna o sistema indispensável para o cliente (Pain Points Resolvidos):
- **Daily Action Lists**: Listas de "O que fazer hoje" para Fábrica e Expedição.
- **Matriz Global de Integridade**: Cross-view de Produtos vs Lojas para identificar excessos e faltas em tempo real.
- **Logística Reversa / Remanejamento**: Otimização do inventário circulante entre unidades de mesmo CNPJ.

## 3. Pilares Técnicos da v2
- **Auditória Forense (v7)**: Nunca confiar no dado espelhado do ERP sem antes passar pelo motor de reconciliação de logs (Sanitization).
- **Imutabilidade do Legado**: O sistema novo apenas consome o legado; nunca escreve nele.
- **Simplicidade de Fluxo**: Eliminar a complexidade burocrática das "tabelas triplas" do legado e focar na Verdade de Prateleira.

## 4. O Diferencial de Mercado
Não é um ERP. É um **Garantidor de Lucro e ROI de Capital**. A inteligência deve agir sobre a verdade física, não sobre o registro contábil.

## 5. Estoque de Vitrine vs. Estoque Disponível (Net-Sellable)
A existência física de uma unidade não garante sua disponibilidade comercial.

### O Erro da "Unidade Única"
Muitos produtos possuem 1 unidade em exposição (mostruário/vitrine). Esta unidade:
- Não está disponível para pronta entrega imediata.
- Sofre depreciação física (poeira, manuseio).
- Se vendida, retira a capacidade de demonstração do mix da loja.

### Lógica de Cálculo
Para fins de auditoria e reposição (TOC), o sistema deve considerar:
**`Saldo_Disponível = MAX(0, Saldo_Fisico - Saldo_Vitrine)`**

### Impacto nas Métricas
Ignorar o estoque de vitrine mascara rupturas reais. Ao subtrair a vitrine, a métrica de ruptura reflete a **capacidade real de venda**, permitindo que o sistema de reposição aja mesmo quando ainda existe 1 unidade física na loja.

