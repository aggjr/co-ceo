const mysql = require('mysql2/promise');

async function targetInvestigation() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idAtivo = 13712;
    const ghostDate = '2023-01-04';

    try {
        const connection = await mysql.createConnection(config);
        
        console.log(`--- Investigando Evento de Salto (+19) em ${ghostDate} ---`);
        
        // 1. Transferências
        console.log("\n[1] Transferências (transferenciaitem):");
        const [transfers] = await connection.query(`
            SELECT Id, IdTransferencia, QtdTransferir, QtdConfirmada, DataCriacao, Status
            FROM transferenciaitem
            WHERE (IdAtivoOrigem = ? OR IdAtivoDestino = ?)
            AND (DATE(DataCriacao) = ? OR DATE(DataAlteracao) = ?)
        `, [idAtivo, idAtivo, ghostDate, ghostDate]);
        console.table(transfers);

        // 2. Produção
        console.log("\n[2] Produção (listaproducaoitem):");
        const [prod] = await connection.query(`
            SELECT Id, IdListaProducao, QtdSugerida, TotalEmProducao, DataCriacao
            FROM listaproducaoitem
            WHERE IdAtivo = ? 
            AND (DATE(DataCriacao) = ? OR DATE(DataAlteracao) = ?)
        `, [idAtivo, ghostDate, ghostDate]);
        console.table(prod);

        // 3. Recebimento
        console.log("\n[3] Recebimento (pedidoitemrecebimento):");
        const [receiv] = await connection.query(`
            SELECT pir.Id, pir.IdPedidoItem, pir.QtdRecebida, pir.DataRecebimento
            FROM pedidoitemrecebimento pir
            JOIN pedidoitem pi ON pir.IdPedidoItem = pi.Id
            WHERE pi.IdAtivo = ? 
            AND DATE(pir.DataRecebimento) = ?
        `, [idAtivo, ghostDate]);
        console.table(receiv);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO NA INVESTIGAÇÃO:", err.message);
    }
}

targetInvestigation();
