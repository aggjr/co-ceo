const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function initDB() {
    let connection;
    try {
        connection = await mysql.createConnection(configLocal);
        console.log("✅ Conectado ao MySQL local: stockspin-bd");

        // 1. Unidade Negocio
        await connection.query(`
            CREATE TABLE IF NOT EXISTS unidade_negocio (
                id CHAR(36) PRIMARY KEY,
                nome VARCHAR(255) NOT NULL,
                tipo ENUM('FABRICA', 'CD', 'LOJA') NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 2. SKU
        await connection.query(`
            CREATE TABLE IF NOT EXISTS sku (
                id BIGINT PRIMARY KEY,
                codigo_erp VARCHAR(50),
                descricao VARCHAR(255),
                unidade_medida VARCHAR(20)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 3. Ativo (SKU + Unidade)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ativo (
                id BIGINT PRIMARY KEY,
                id_sku BIGINT,
                id_unidade_negocio CHAR(36),
                posicao_calc DECIMAL(18,2) DEFAULT 0,
                FOREIGN KEY (id_sku) REFERENCES sku(id),
                FOREIGN KEY (id_unidade_negocio) REFERENCES unidade_negocio(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 4. Natureza Movimento
        await connection.query(`
            CREATE TABLE IF NOT EXISTS natureza_movimento (
                id INT PRIMARY KEY,
                descricao VARCHAR(100),
                operacao ENUM('CREDITO', 'DEBITO') NOT NULL,
                gatilho ENUM('VENDA', 'PROD', 'TRANSF', 'AJUSTE', 'COMPRA')
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 5. Movimento Estoque
        await connection.query(`
            CREATE TABLE IF NOT EXISTS movimento_estoque (
                id CHAR(36) PRIMARY KEY,
                id_ativo BIGINT,
                id_natureza INT,
                quantidade DECIMAL(18,2),
                saldo_apos DECIMAL(18,2),
                doc_origem VARCHAR(100),
                data_evento DATETIME,
                data_inclusao DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (id_ativo) REFERENCES ativo(id),
                FOREIGN KEY (id_natureza) REFERENCES natureza_movimento(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 6. Remessa Logistica
        await connection.query(`
            CREATE TABLE IF NOT EXISTS remessa_logistica (
                id CHAR(36) PRIMARY KEY,
                responsavel VARCHAR(255),
                modal ENUM('VEICULO', 'A_PE', 'MOTO'),
                status ENUM('ABERTO', 'TRANSITO', 'CONCLUIDO') DEFAULT 'ABERTO',
                data_saida DATETIME,
                data_chegada DATETIME
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 7. Transferencia
        await connection.query(`
            CREATE TABLE IF NOT EXISTS transferencia (
                id CHAR(36) PRIMARY KEY,
                id_remessa_logistica CHAR(36),
                id_ativo_origem BIGINT,
                id_ativo_destinho BIGINT,
                qtd_enviada DECIMAL(18,2),
                qtd_recebida DECIMAL(18,2),
                status_conferencia ENUM('OK', 'DIVERGENTE') DEFAULT 'OK',
                data_conclusao DATETIME,
                FOREIGN KEY (id_remessa_logistica) REFERENCES remessa_logistica(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 8. Estoque Diario
        await connection.query(`
            CREATE TABLE IF NOT EXISTS estoque_diario (
                id_ativo BIGINT,
                data DATE,
                saldo_real_reprocessado DECIMAL(18,2),
                saldo_original_decisao DECIMAL(18,2),
                status_buffer ENUM('VERDE', 'AMARELO', 'VERMELHO'),
                PRIMARY KEY (id_ativo, data),
                FOREIGN KEY (id_ativo) REFERENCES ativo(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 9. Parametros TOC
        await connection.query(`
            CREATE TABLE IF NOT EXISTS parametros_toc (
                id_ativo BIGINT PRIMARY KEY,
                buffer_verde DECIMAL(18,2),
                buffer_amarelo DECIMAL(18,2),
                buffer_vermelho DECIMAL(18,2),
                lead_time_medio INT,
                FOREIGN KEY (id_ativo) REFERENCES ativo(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        console.log("🚀 Schema inicializado com sucesso!");

    } catch (err) {
        console.error("❌ Erro ao inicializar banco local:", err.message);
    } finally {
        if (connection) await connection.end();
    }
}

initDB();
