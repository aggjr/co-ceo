const mysql = require('mysql2/promise');

async function deepAudit() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idAtivo = 13712;

    try {
        const connection = await mysql.createConnection(config);
        
        console.log("--- Investigando Tabela: movimentacao ---");
        const [movs] = await connection.query("SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao FROM movimentacao WHERE IdAtivo = ? ORDER BY DataMovimentacao DESC LIMIT 10", [idAtivo]);
        console.log("Movimentacao:", movs);

        console.log("\n--- Investigando Tabela: lancamento (Últimos 10) ---");
        const [lancs] = await connection.query("SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao FROM lancamento WHERE IdAtivo = ? ORDER BY DataMovimentacao DESC LIMIT 10", [idAtivo]);
        console.log("Lancamento:", lancs);

        console.log("\n--- Investigando Tabela: transferenciaitem ---");
        const [transfers] = await connection.query("SELECT QtdTransferir, QtdConfirmada, DataCriacao FROM transferenciaitem WHERE IdAtivoOrigem = ? OR IdAtivoDestino = ? ORDER BY DataCriacao DESC LIMIT 10", [idAtivo, idAtivo]);
        console.log("Transferencias:", transfers);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

deepAudit();
