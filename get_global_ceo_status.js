const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function checkStatus() {
    try {
        const conn = await mysql.createConnection(configLocal);
        
        console.log("--- STATUS ATUAL GLOBAL CO-CEO (Paciente Zero) ---");
        
        const [rows] = await conn.query(`
            SELECT id_ativo, saldo_real_reprocessado as saldo 
            FROM estoque_diario 
            WHERE (id_ativo, data) IN (
                SELECT id_ativo, MAX(data) 
                FROM estoque_diario 
                GROUP BY id_ativo
            )
        `);

        let total = 0;
        rows.forEach(r => {
            const s = parseFloat(r.saldo);
            total += s;
            console.log(`Ativo ${r.id_ativo.toString().padEnd(6)} | Saldo: ${s.toFixed(2).padStart(6)}`);
        });

        console.log("--------------------------------------------------");
        console.log(`TOTAL CONSOLIDADO NO CO-CEO: ${total.toFixed(2)}`);
        console.log(`ALVO NO DASHBOARD OFICIAL: 8.00`);
        console.log(`DIVERGÊNCIA GLOBAL: ${(total - 8).toFixed(2)}`);

        await conn.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

checkStatus();
