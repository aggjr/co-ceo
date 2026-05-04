const mysql = require('mysql2/promise');

async function test() {
    console.log("Iniciando tentativa de conexão com parâmetros oficiais...");
    try {
        const connection = await mysql.createConnection({
            host: '35.168.3.139',
            port: 3306,
            user: 'foccus_usr',
            password: 'u8Ihs@$OIT3b6sg6Kdka', // O caractere $ é literal aqui
            database: 'stockspin_core_db_saron',
            ssl: {
                rejectUnauthorized: false
            }
        });

        console.log("✅ CONEXÃO ESTABELECIDA COM SUCESSO!");
        
        const [tables] = await connection.query('SHOW TABLES');
        console.log("Tabelas encontradas:", tables.map(t => Object.values(t)[0]));

        await connection.end();
    } catch (err) {
        console.error("❌ FALHA NA CONEXÃO:");
        console.error("Mensagem:", err.message);
        console.error("Código:", err.code);
        console.error("Host de Origem (Meu IP):", err.address || "Não identificado");
    }
}

test();
