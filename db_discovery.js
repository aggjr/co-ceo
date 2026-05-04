const mysql = require('mysql2/promise');
const fs = require('fs');

async function discover() {
    console.log("Conectando ao banco legado para mapeamento seguro...");
    
    try {
        const connection = await mysql.createConnection({
            host: '35.168.3.139',
            port: 3306,
            user: 'foccus_usr',
            password: 'u8Ihs@$OIT3b6sg6Kdka',
            database: 'stockspin_core_db_saron'
        });

        // 1. Listar Tabelas
        const [tables] = await connection.query('SHOW TABLES');
        let report = "# Relatório de Estrutura do Banco Legado\n\n";
        report += "Este relatório foi gerado automaticamente através de comandos de leitura (READ-ONLY).\n\n";

        for (let table of tables) {
            const tableName = Object.values(table)[0];
            report += `## Tabela: \`${tableName}\`\n\n`;
            
            // 2. Mapear Colunas
            const [columns] = await connection.query(`DESCRIBE ${tableName}`);
            report += "| Campo | Tipo | Nulo | Chave | Padrão | Extra |\n";
            report += "|-------|------|------|-------|--------|-------|\n";
            
            columns.forEach(col => {
                report += `| ${col.Field} | ${col.Type} | ${col.Null} | ${col.Key} | ${col.Default || ''} | ${col.Extra} |\n`;
            });
            report += "\n---\n\n";
        }

        fs.writeFileSync('schema_report.md', report);
        console.log("Mapeamento concluído com sucesso. Relatório gerado em 'schema_report.md'.");

        await connection.end();
    } catch (err) {
        console.error("ERRO DURANTE O MAPEAMENTO:", err.message);
    }
}

discover();
