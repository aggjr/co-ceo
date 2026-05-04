const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function auditOrphans() {
    let conn;
    try {
        conn = await mysql.createConnection(assertLegacyConfig());
        console.log("--- AUDITORIA DE DESTINOS: SKU 2061 (PACIENTE ZERO) ---");

        // Lista de ativos vinculados ao PACIENTE ZERO
        const idsPacienteZero = [13712, 13713, 13714, 13715, 13716, 13717, 13718, 18432, 24399, 28965];
        
        // Query que cruza a saída da fábrica com a entrada em outras unidades, apenas para este produto
        const query = `
            SELECT 
                u.NomeFantasia, 
                COUNT(*) as qtd_transferencias,
                SUM(m_in.Quantidade) as volume_recebido
            FROM movimentacao m_out
            JOIN movimentacao m_in ON m_out.OrigemObservacao = m_in.OrigemObservacao
            JOIN ativo a ON m_in.IdAtivo = a.Id
            JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio
            WHERE m_out.IdAtivo = 13712 
              AND m_out.IdTipoMovimentacao = 12 
              AND m_in.IdTipoMovimentacao = 5
              AND m_in.IdAtivo IN (${idsPacienteZero.join(',')})
              AND m_in.IdAtivo <> 13712
            GROUP BY u.NomeFantasia
            ORDER BY volume_recebido DESC
        `;

        const [rows] = await conn.query(query);
        console.table(rows);

        // Verificando discrepâncias individuais
        console.log("\n--- RESUMO DE CONCILIAÇÃO ---");
        const totalSaida = 435; // Já sabemos
        const totalEntradaReal = rows.reduce((acc, r) => acc + Number(r.volume_recebido), 0);
        console.log(`Total Saído do CD: ${totalSaida}`);
        console.log(`Total Recebido nas Lojas (Rastreado): ${totalEntradaReal}`);
        console.log(`Abismo Logístico (Diferença): ${totalSaida - totalEntradaReal}`);

    } catch (err) {
        console.error("ERRO:", err.message);
    } finally {
        if (conn) await conn.end();
    }
}

auditOrphans();
