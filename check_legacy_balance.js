const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function check() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        // Verificando na tabela 'estoque' que é o snapshot atual do legado
        const [e] = await connection.query('SELECT Disponivel FROM estoque WHERE IdAtivo = 13712');
        console.log('Legacy "Estoque" (Disponível):', e[0]?.Disponivel);

        // Verificando o último totalizador
        const [t] = await connection.query('SELECT EstoqueDisponivel FROM ativototalizador WHERE IdAtivo = 13712');
        console.log('Legacy "Totalizador":', t[0]?.EstoqueDisponivel);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

check();
