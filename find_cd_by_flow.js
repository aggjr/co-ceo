const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function findCD() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        // 1. Ver quem mais recebe transferências do Paciente Zero
        const [receivers] = await connection.query(`
            SELECT u.NomeFantasia, count(*) as Qtd
            FROM transferenciaitem ti
            JOIN ativo a ON ti.IdAtivoDestino = a.Id
            JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio
            WHERE a.IdProduto = 2061
            GROUP BY u.NomeFantasia
            ORDER BY Qtd DESC
        `);
        console.log('--- Unidades que RECEBEM transferências ---');
        console.table(receivers);

        // 2. Ver quem mais ENVIA transferências do Paciente Zero
        const [senders] = await connection.query(`
            SELECT u.NomeFantasia, count(*) as Qtd
            FROM transferenciaitem ti
            JOIN ativo a ON ti.IdAtivoOrigem = a.Id
            JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio
            WHERE a.IdProduto = 2061
            GROUP BY u.NomeFantasia
            ORDER BY Qtd DESC
        `);
        console.log('--- Unidades que ENVIAM transferências (Candidatas a CD) ---');
        console.table(senders);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

findCD();
