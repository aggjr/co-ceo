const mysql = require('mysql2/promise');

async function checkDeletados() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const factoryId = '2617f48e-0571-4054-bd43-da4738e2a3ac';
    const date = '2023-01-04';

    try {
        const connection = await mysql.createConnection(config);
        
        console.log(`--- Verificando Registros Deletados em ${date} ---`);
        const [delL] = await connection.query("SELECT COUNT(*) as Qtd FROM lancamento WHERE IdUnidadeNegocio = ? AND DataMovimentacao = ? AND IndDeletado = 1", [factoryId, date]);
        const [delM] = await connection.query("SELECT COUNT(*) as Qtd FROM movimentacao WHERE IdUnidadeNegocio = ? AND DataMovimentacao = ? AND IndDeletado = 1", [factoryId, date]);
        
        console.log("Lançamentos Deletados:", delL[0].Qtd);
        console.log("Movimentações Deletadas:", delM[0].Qtd);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

checkDeletados();
