const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function syncPacienteZero() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Conectado a ambos os bancos.");

        const idAtivo = 13712;
        const idProdutoAtivo = 2061; // Produto 'Cortina Lux...'
        const idUnidadeNegocio = '2617f48e-0571-4054-bd43-da4738e2a3ac'; // Fábrica

        // 1. Sincronizar Unidade Negócio
        console.log("--- Sincronizando Unidade Negócio ---");
        const [unit] = await connLegacy.query("SELECT IdUnidadeNegocio as Id, NomeFantasia as Nome FROM unidadenegocio WHERE IdUnidadeNegocio = ?", [idUnidadeNegocio]);
        if (unit.length > 0) {
            await connLocal.query("INSERT IGNORE INTO unidade_negocio (id, nome, tipo) VALUES (?, ?, ?)", [unit[0].Id, unit[0].Nome, 'FABRICA']);
        }

        // 2. Sincronizar SKU
        console.log("--- Sincronizando SKU ---");
        const [prod] = await connLegacy.query("SELECT * FROM produto WHERE Id = ?", [idProdutoAtivo]);
        if (prod.length > 0) {
            await connLocal.query("INSERT IGNORE INTO sku (id, codigo_erp, descricao, unidade_medida) VALUES (?, ?, ?, ?)", 
                [prod[0].Id, prod[0].IdExterno, prod[0].Descricao, 'UN']);
        }

        // 3. Sincronizar Ativo
        console.log("--- Sincronizando Ativo ---");
        const [ativo] = await connLegacy.query("SELECT * FROM ativo WHERE Id = ?", [idAtivo]);
        if (ativo.length > 0) {
            await connLocal.query("INSERT IGNORE INTO ativo (id, id_sku, id_unidade_negocio, posicao_calc) VALUES (?, ?, ?, ?)", 
                [ativo[0].Id, ativo[0].IdProduto, ativo[0].IdUnidadeNegocio, 0]);
        }

        // 4. Popular Naturezas (Semi-estático)
        console.log("--- Populando Naturezas ---");
        const naturezas = [
            [1, 'Venda Saída', 'DEBITO', 'VENDA'],
            [2, 'Compra Entrada', 'CREDITO', 'COMPRA'],
            [5, 'Transferência Entrada', 'CREDITO', 'TRANSF'],
            [9, 'Entrada Produção', 'CREDITO', 'PROD'],
            [10, 'Saldo Inicial', 'CREDITO', 'AJUSTE'],
            [12, 'Transferência Saída', 'DEBITO', 'TRANSF'],
            [99, 'Ajuste Sistêmico (Ghost)', 'CREDITO', 'AJUSTE']
        ];
        for (const n of naturezas) {
            await connLocal.query("INSERT IGNORE INTO natureza_movimento (id, descricao, operacao, gatilho) VALUES (?, ?, ?, ?)", n);
        }

        // 5. Sincronizar Movimentações (Descontaminadas)
        console.log("--- Sincronizando Movimentações (Paciente Zero) ---");
        
        // Puxamos de ambas as tabelas e aplicamos o fingerprint para evitar duplicação (como no nosso auditor)
        const [moves] = await connLegacy.query(`
            SELECT Id, Quantidade, IdTipoMovimentacao, DataMovimentacao, DataCriacao, 'L' as Origem, Id as DocOrigem
            FROM lancamento WHERE IdAtivo = ? AND IndDeletado = 0
            UNION ALL
            SELECT Id, Quantidade, IdTipoMovimentacao, DataMovimentacao, DataCriacao, 'M' as Origem, Id as DocOrigem
            FROM movimentacao WHERE IdAtivo = ? AND IndDeletado = 0
            ORDER BY DataMovimentacao, DataCriacao
        `, [idAtivo, idAtivo]);

        const fingerprints = new Set();
        let count = 0;

        for (const m of moves) {
            const fingerprint = `${m.DataMovimentacao.toISOString()}_${m.Quantidade}_${m.IdTipoMovimentacao}`;
            if (fingerprints.has(fingerprint)) continue;
            fingerprints.add(fingerprint);

            // Mapeamento simples de Natureza (só para esse teste)
            let idNatureza = m.IdTipoMovimentacao;
            if (![1,2,5,9,10,12].includes(idNatureza)) idNatureza = 99;

            await connLocal.query(`
                INSERT IGNORE INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, data_inclusao, doc_origem)
                VALUES (UUID(), ?, ?, ?, ?, ?, ?)
            `, [idAtivo, idNatureza, m.Quantidade, m.DataMovimentacao, m.DataCriacao, `Legado_${m.Origem}_${m.DocOrigem}`]);
            count++;
        }

        console.log(`🚀 Sincronização concluída! ${count} movimentos inseridos.`);

    } catch (err) {
        console.error("❌ Erro na sincronização:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

syncPacienteZero();
