const mysql = require('mysql2/promise');

async function deepDive() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idProduto = 3021; 
    const factoryId = '2617f48e-0571-4054-bd43-da4738e2a3ac';
    const startDate = '2022-12-20';
    const endDate = '2023-01-10';

    try {
        const connection = await mysql.createConnection(config);
        
        console.log(`--- Deep Dive: Pista das 19 unidades de Jan/2023 ---`);

        // 1. Procurar RECEBIMENTOS em QUALQUER UNIDADE para este produto
        console.log("\n[1] Recebimentos (pedidoitemrecebimento) para o Produto 3021 em QUALQUER unidade:");
        const [receiv] = await connection.query(`
            SELECT pir.Id, pir.QtdRecebida, pir.DataRecebimento, pir.IdUnidadeNegocio
            FROM pedidoitemrecebimento pir
            JOIN pedidoitem pi ON pir.IdPedidoItem = pi.Id
            WHERE pi.IdProduto = ? 
            AND pir.DataRecebimento BETWEEN ? AND ?
        `, [idProduto, startDate, endDate]);
        console.table(receiv);

        // 2. Procurar TRANSFERÊNCIAS para a FÁBRICA
        console.log("\n[2] Transferências (transferenciaitem) - Destino Fábrica:");
        const [transfers] = await connection.query(`
            SELECT ti.Id, ti.QtdTransferir, ti.QtdConfirmada, ti.DataCriacao, ti.DataRecebimento
            FROM transferenciaitem ti
            WHERE ti.IdProduto = ? AND ti.IdAtivoDestino IN (SELECT Id FROM ativo WHERE IdUnidadeNegocio = ?)
            AND ti.DataCriacao BETWEEN ? AND ?
        `, [idProduto, factoryId, startDate, endDate]);
        console.table(transfers);

        // 3. Procurar LANÇAMENTOS sem Ativo? (Pode ser erro de integridade)
        console.log("\n[3] Lançamentos (lancamento) - Produto 3021 (independente de Ativo):");
        const [lancs] = await connection.query(`
            SELECT l.Id, l.Quantidade, l.DataMovimentacao, l.IdTipoMovimentacao, l.IdUnidadeNegocio
            FROM lancamento l
            WHERE l.IdAtivo IN (SELECT Id FROM ativo WHERE IdProduto = ?)
            AND l.DataMovimentacao BETWEEN ? AND ?
        `, [idProduto, startDate, endDate]);
        console.table(lancs);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO NO DEEP DIVE:", err.message);
    }
}

deepDive();
