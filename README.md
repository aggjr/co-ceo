# STOCKSPIN — Supply Chain Modeler (Client: SARON)

O STOCKSPIN é um modelador de inteligência de cadeia de suprimentos focado em varejo de alta performance. Diferente de um ERP tradicional, ele atua como uma camada de decisão estatística para garantir a disponibilidade plena de produtos com o mínimo de inventário possível.

## Visão Geral do Sistema
O sistema modela a rede da SARON composta por:
- **Fábrica**: Produção puxada pela demanda real.
- **Centro de Distribuição (CD)**: Pulmão regulador centralizado (Regra de Raiz de N).
- **Lojas (8 a 10 unidades)**: Pontos de venda físicos com integração diária de PDV.
- **Venda Web**: Unidade virtual integrada à estrutura física para gestão de canais.

## Princípios de Modelagem (V38.3+)
- **Disponibilidade^N**: O objetivo mestre é a disponibilidade do "cesto completo". A falta de um item impacta a fidelidade e o ticket médio de forma exponencial.
- **Nem a Mais, Nem a Menos**: Ajuste fino de estoques de segurança baseado na variabilidade real calculada diariamente.
- **Reposição por Puxada Diária**: Modelagem baseada no fluxo de saída real das lojas.
