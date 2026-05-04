const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function syncGlobalMetadata() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Conectado a ambos os bancos.");

        // 1. Sincronizar todas as Unidades Negócio relacionadas ao Paciente Zero
        console.log("--- Sincronizando Unidades Negócio Global ---");
        const [units] = await connLegacy.query(`
            SELECT DISTINCT u.IdUnidadeNegocio as Id, u.NomeFantasia as Nome, u.Tipo
            FROM unidadenegocio u
            JOIN ativo a ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
            WHERE a.IdProduto = 2061 AND a.IndDeletado = 0
        `);

        for (const u of units) {
            let tipoCoCeo = 'LOJA';
            if (u.Nome.includes('Fábrica')) tipoCoCeo = 'FABRICA';
            if (u.Nome.includes('CD')) tipoCoCeo = 'CD';

            await connLocal.query("INSERT IGNORE INTO unidade_negocio (id, nome, tipo) VALUES (?, ?, ?)", [u.Id, u.Nome, tipoCoCeo]);
            console.log(`Logística: ${u.Nome} [${tipoCoCeo}] cadastrada.`);
        }

        // 2. Sincronizar SKUs (Geral)
        const [skus] = await connLegacy.query("SELECT Id, IdExterno, Descricao FROM produto WHERE Id = 2061");
        for (const s of skus) {
            await connLocal.query("INSERT IGNORE INTO sku (id, codigo_erp, descricao, unidade_medida) VALUES (?, ?, ?, ?)", 
                [s.Id, s.IdExterno, s.Descricao, 'UN']);
        }

        // 3. Sincronizar Ativos
        const [ativos] = await connLegacy.query("SELECT Id, IdProduto, IdUnidadeNegocio FROM ativo WHERE IdProduto = 2061 AND IndDeletado = 0");
        for (const a of ativos) {
            await connLocal.query("INSERT IGNORE INTO ativo (id, id_sku, id_unidade_negocio, posicao_calc) VALUES (?, ?, ?, ?)", 
                [a.Id, a.IdProduto, a.IdUnidadeNegocio, 0]);
        }

        console.log(`🚀 Metadados Globais sincronizados: ${units.length} unidades e ${ativos.length} ativos.`);

    } catch (err) {
        console.error("❌ Erro na sincronização de metadados:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

syncGlobalMetadata();
