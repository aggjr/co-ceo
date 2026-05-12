const brapiService = require('./modules/invest/services/brapiService');

async function main() {
    console.log('--- Triggering getQuotes for mixture of stocks and options ---');
    try {
        const results = await brapiService.getQuotes(['PETR4', 'PETRH322']);
        console.log('\nFINAL UNIFIED RESULTS:', JSON.stringify(results, null, 2));
    } catch (e) {
        console.error('Global Failure:', e.message);
    }
    process.exit(0);
}

main();
