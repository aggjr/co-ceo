const mysql = require('mysql2/promise');

async function findSubject() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    try {
        const connection = await mysql.createConnection(config);
        
        console.log("--- Localizando Produto exato ---");
        const [prod] = await connection.query("SELECT Id, Descricao, ErpCodigo FROM produto WHERE Descricao LIKE '%LINHO ELEGANCE%' OR ErpCodigo = '12218'");
        console.log(prod);

        if (prod.length > 0) {
            const prodId = prod[0].Id;
            const factoryId = '2617f48e-0571-4054-bd43-da4738e2a3ac';
            
            console.log("\n--- Localizando Ativo correspondente (Fábrica) ---");
            const [ativo] = await connection.query("SELECT Id FROM ativo WHERE IdProduto = ? AND IdUnidadeNegocio = ?", [prodId, factoryId]);
            console.log(ativo);
        }

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

findSubject();
