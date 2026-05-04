const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function identifyCD() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        const orphanIds = [
            '1589138b-9134-4570-8cc0-537da176ea06',
            '6f51fddb-0e2e-4caa-b83a-ad4fc20e379a'
        ];

        console.log('--- Analisando Identidade das Unidades Órfãs ---');
        
        for (const id of orphanIds) {
            // Ver se tem Ativo para o Paciente Zero
            const [ativo] = await connection.query('SELECT Id FROM ativo WHERE IdUnidadeNegocio = ? AND IdProduto = 2061', [id]);
            const idAtivo = ativo[0]?.Id;
            
            if (idAtivo) {
                console.log(`\nUnidade ID: ${id} (Ativo: ${idAtivo})`);
                
                // Ver volume de movimentação
                const [moves] = await connection.query('SELECT COUNT(*) as c FROM movimentacao WHERE IdAtivo = ?', [idAtivo]);
                console.log(`Volume Movimentação: ${moves[0].c}`);

                // Ver as últimas datas e valores do histórico
                const [history] = await connection.query('SELECT DataMovimentacao, Quantidade FROM historicoestoque WHERE IdAtivo = ? ORDER BY DataMovimentacao DESC LIMIT 1', [idAtivo]);
                console.log(`Último Saldo Histórico: ${history[0]?.Quantidade || 'N/A'} em ${history[0]?.DataMovimentacao || 'N/A'}`);
            }
        }

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

identifyCD();
