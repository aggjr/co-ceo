const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function researchWeb() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        const idWeb = 'fc3a0cd0-8b20-4e77-b7d7-2299a5683ff8';
        const idFactory = '2617f48e-0571-4054-bd43-da4738e2a3ac';
        const idProduto = 2061;

        console.log(`--- Analisando Web (${idWeb}) vs Fábrica (${idFactory}) ---`);

        // 1. Ver Ativos
        const [ativos] = await connection.query('SELECT a.Id, u.IdUnidadeNegocio, u.NomeFantasia FROM ativo a JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio WHERE a.IdProduto = ? AND a.IdUnidadeNegocio IN (?, ?)', [idProduto, idWeb, idFactory]);
        console.table(ativos);

        // 2. Ver Saldo Histórico da Web antes e depois de 05/2025
        const [webHistory] = await connection.query(`
            SELECT 
                COUNT(*) as TotalRegistros,
                SUM(CASE WHEN DataMovimentacao < '2025-05-01' THEN 1 ELSE 0 END) as AntesMaio25,
                SUM(CASE WHEN DataMovimentacao >= '2025-05-01' THEN 1 ELSE 0 END) as AposMaio25,
                MAX(CASE WHEN DataMovimentacao < '2025-05-01' THEN Quantidade ELSE 0 END) as MaxSaldoAntes
            FROM historicoestoque 
            WHERE IdAtivo IN (SELECT Id FROM ativo WHERE IdProduto = ? AND IdUnidadeNegocio = ?)
        `, [idProduto, idWeb]);
        console.log('--- Resumo Histórico Web ---');
        console.table(webHistory);

        // 3. Ver se existem transferências entre Fábrica e Web
        const [transfers] = await connection.query(`
            SELECT count(*) as c, sum(QtdTransferir) as tot
            FROM transferenciaitem 
            WHERE (IdAtivoOrigem IN (SELECT Id FROM ativo WHERE IdProduto = ? AND IdUnidadeNegocio = ?) AND IdAtivoDestino IN (SELECT Id FROM ativo WHERE IdProduto = ? AND IdUnidadeNegocio = ?))
               OR (IdAtivoOrigem IN (SELECT Id FROM ativo WHERE IdProduto = ? AND IdUnidadeNegocio = ?) AND IdAtivoDestino IN (SELECT Id FROM ativo WHERE IdProduto = ? AND IdUnidadeNegocio = ?))
        `, [idProduto, idFactory, idProduto, idWeb, idProduto, idWeb, idProduto, idFactory]);
        console.log('--- Transferências entre Fábrica e Web ---');
        console.table(transfers);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

researchWeb();
