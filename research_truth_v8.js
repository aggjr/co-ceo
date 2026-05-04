const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function findTruth() {
    console.log('🔍 Iniciando Auditoria de Sincronismo (Ponto de Verdade)...');
    const c = await mysql.createConnection(configLocal);
    const idSku = 3097;
    const idUnidade = 'd2e487d5-7341-4beb-b5f7-22d993b7f096';
    try {
        const [res] = await c.query(`
            SELECT 
                m.data_evento, 
                m.quantidade, 
                n.descricao as natureza, 
                n.operacao 
            FROM movimento_estoque m 
            JOIN natureza_movimento n ON m.id_natureza = n.id 
            JOIN ativo a ON m.id_ativo = a.id 
            WHERE a.id_sku = ? 
              AND a.id_unidade_negocio = ? 
              AND m.data_evento >= '2023-04-18' 
            ORDER BY m.data_evento ASC 
            LIMIT 200
        `, [idSku, idUnidade]);
        
        console.log('Data | Qtd | Operação | Natureza');
        console.log('--------------------------------------------------');
        
        res.forEach(m => {
            console.log(`${m.data_evento.toISOString().split('T')[0]} | ${parseFloat(m.quantidade).toFixed(2)} | ${m.operacao} | ${m.natureza}`);
        });

    } catch(e) {
        console.error(e);
    } finally {
        await c.end();
    }
}

findTruth();
