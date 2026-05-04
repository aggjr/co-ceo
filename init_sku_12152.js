const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function init12152() {
    let conn;
    try {
        conn = await mysql.createConnection(configLocal);
        console.log("🛠️ Preparando base local para SKU 12152...");

        // 1. Inserir SKU
        await conn.query(`
            INSERT IGNORE INTO sku (id, codigo_erp, descricao, unidade_medida)
            VALUES (3097, '12152', 'CORTINA LUX DARK LINHO ELEGANCE PEROLA 4.00X2.60', 'UN')
        `);

        // 2. Inserir Ativos (CD e Lojas)
        const ativos = [
            [26910, 3097, '2617f48e-0571-4054-bd43-da4738e2a3ac'], // Fábrica
            [26911, 3097, '2f6185d8-717a-45e6-9bb5-1f95909f72cd'], // Guaranis
            [26912, 3097, '58491bdb-76a3-41a5-840d-40c66dbcd4c8'], // G2
            [26913, 3097, '9b406689-94b0-4414-a4fd-479e9991e2c3'], // Betim
            [26914, 3097, 'a6520ab1-f211-426b-aff3-48f0a7a1e240'], // Carijós
            [26915, 3097, 'beefa1ad-7b50-4700-bdd0-0dfaba1f4e1f'], // Venda Nova
            [26916, 3097, 'd2e487d5-7341-4beb-b5f7-22d993b7f096'], // Barreiro
            [26917, 3097, 'e5d349c9-bd0e-4c20-a338-c4f4af859890'], // Babita
            [26918, 3097, 'f2fe5e7e-0606-4132-9247-4ac6772a0186'], // Tupis
            [29758, 3097, '356c322c-96dd-4b48-82e5-3dc60a5f3796']  // Eldorado 2
        ];

        for (const [id, id_sku, id_unidade] of ativos) {
            await conn.query(`
                INSERT IGNORE INTO ativo (id, id_sku, id_unidade_negocio)
                VALUES (?, ?, ?)
            `, [id, id_sku, id_unidade]);
        }

        console.log("✅ SKU 12152 e Ativos cadastrados localmente.");

    } catch (err) {
        console.error("ERRO:", err.message);
    } finally {
        if (conn) await conn.end();
    }
}

init12152();
