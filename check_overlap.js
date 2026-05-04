const mysql = require('mysql2/promise');

async function checkOverlap() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idAtivo = 13712;

    try {
        const connection = await mysql.createConnection(config);
        
        console.log("--- Cruzando IDs entre lancamento e movimentacao ---");
        const [idOverlap] = await connection.query(`
            SELECT COUNT(*) as count 
            FROM lancamento l
            INNER JOIN movimentacao m ON l.Id = m.Id
            WHERE l.IdAtivo = ?
        `, [idAtivo]);
        console.log("Contagem de IDs idênticos:", idOverlap[0].count);

        console.log("\n--- Cruzando Conteúdo (sem depender de ID) ---");
        const [contentOverlap] = await connection.query(`
            SELECT COUNT(*) as count 
            FROM lancamento l
            INNER JOIN movimentacao m ON 
                l.IdAtivo = m.IdAtivo AND 
                l.Quantidade = m.Quantidade AND 
                l.IdTipoMovimentacao = m.IdTipoMovimentacao AND 
                l.DataMovimentacao = m.DataMovimentacao
            WHERE l.IdAtivo = ?
        `, [idAtivo]);
        console.log("Contagem de registros com conteúdo idêntico:", contentOverlap[0].count);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

checkOverlap();
