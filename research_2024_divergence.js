const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function research() {
    try {
        const conn = await mysql.createConnection(configLocal);
        
        console.log("--- Analisando Movimentações de Fevereiro/2024 (Ativo 13712) ---");
        
        const [rows] = await conn.query(`
            SELECT m.data_evento, m.quantidade, n.descricao, m.doc_origem 
            FROM movimento_estoque m 
            JOIN natureza_movimento n ON m.id_natureza = n.id 
            WHERE m.id_ativo = 13712 AND m.data_evento BETWEEN '2024-02-01' AND '2024-03-15'
            ORDER BY m.data_evento ASC
        `);

        if (rows.length === 0) {
            console.log("Nenhum movimento encontrado no período.");
        } else {
            rows.forEach(r => {
                console.log(`${r.data_evento.toISOString().split('T')[0]} | Qtd: ${r.quantidade} | Tipo: ${r.descricao} | Doc: ${r.doc_origem}`);
            });
        }

        await conn.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

research();
