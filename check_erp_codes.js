const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');
const mysql = require('mysql2/promise');

async function run() {
    const c = await mysql.createConnection(assertLegacyConfig());

    // O código 12152 provavelmente é o ID do ATIVO, não do produto
    const [byAtivo] = await c.query("SELECT a.Id as IdAtivo, p.Id as IdProduto, p.Descricao FROM ativo a JOIN produto p ON a.IdProduto = p.Id WHERE a.Id = 12152 LIMIT 5");
    console.log('Ativo 12152:', JSON.stringify(byAtivo, null, 2));

    // Buscar pelo ID do produto diretamente
    const [byProd] = await c.query("SELECT Id, Descricao FROM produto WHERE Id = 12152 LIMIT 5");
    console.log('Produto Id=12152:', JSON.stringify(byProd, null, 2));

    // Verificar o campo IdExterno como alternativa de código
    const [externo] = await c.query("SELECT Id, IdExterno, Descricao FROM produto WHERE IdExterno LIKE '%12152%' LIMIT 5");
    console.log('Por IdExterno 12152:', JSON.stringify(externo, null, 2));

    // Como os ativos se organizam - ver a estrutura real
    const [sample] = await c.query("SELECT a.Id, a.IdProduto, p.Descricao FROM ativo a JOIN produto p ON a.IdProduto = p.Id LIMIT 5");
    console.log('Ativos de exemplo:', JSON.stringify(sample, null, 2));

    await c.end();
}
run();
