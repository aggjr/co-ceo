const mysql = require('mysql2/promise');

async function necropsy() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idAtivo = 13712;
    const date = '2024-11-19';

    try {
        const connection = await mysql.createConnection(config);

        console.log(`--- Necrópsia do dia ${date} (GAP: 11 units) ---`);

        const [moves] = await connection.query(`
            SELECT Id, IdTipoMovimentacao, Quantidade, DataMovimentacao, Responsavel, 'L' as Origem
            FROM lancamento WHERE IdAtivo = ? AND DATE(DataMovimentacao) = ?
            UNION ALL
            SELECT Id, IdTipoMovimentacao, Quantidade, DataMovimentacao, Responsavel, 'M' as Origem
            FROM movimentacao WHERE IdAtivo = ? AND DATE(DataMovimentacao) = ?
        `, [idAtivo, date, idAtivo, date]);
        console.table(moves);

        // Verificar se houve algo na tabela de produção
        const [prod] = await connection.query(`
            SELECT * FROM listaproducaoitem WHERE IdAtivo = ? AND DATE(DataCriacao) = ?
        `, [idAtivo, date]);
        console.log("Produção:", prod);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO NA NECRÓPSIA:", err.message);
    }
}

necropsy();
