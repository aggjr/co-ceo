const fs = require('fs');

// Path to the data file
const dataPath = 'C:/co_ceo/data/js/sku_49.js';

function analyze() {
    const content = fs.readFileSync(dataPath, 'utf8');
    
    // Extract the JSON part
    // The file structure might have changed or I need a more robust extraction
    let data;
    try {
        const jsonMatch = content.match(/const APOLLO_NETWORK_DATA = (\{.*\});/s);
        if (jsonMatch) {
            data = JSON.parse(jsonMatch[1]);
        } else {
            // Try different pattern
            const startIdx = content.indexOf('{');
            const endIdx = content.lastIndexOf('}') + 1;
            data = JSON.parse(content.substring(startIdx, endIdx));
        }
    } catch (e) {
        console.error("JSON Parse Error:", e.message);
        return;
    }

    // Adjusting for the actual structure found in the previous run
    const info = data.info || { name: 'Unknown', code: 'N/A' };
    const results = data.results || data;

    const report = [];
    report.push("# Forensic Inventory Analysis: SKU 49");
    report.push("");
    report.push(`**Product:** ${info.name}`);
    report.push(`**Code:** ${info.code}`);
    report.push(`**Analysis Date:** ${new Date().toISOString()}`);
    report.push("");

    report.push("## 1. Branch Performance Summary");
    report.push("");
    report.push("| Branch | Physical | Available | Suggestion | Target (P150) | Lost Units | Rupture % | Rule Violations |");
    report.push("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |");

    let totalLost = 0;

    for (const branch in results) {
        const branchData = results[branch];
        const m = branchData.metrics;
        const timeline = branchData.timeline;
        
        if (!m || !timeline) continue;

        // Rule Violation Check: Available Stock should be MAX(0, Physical - Vitrine)
        const negativeDays = timeline.filter(d => d.availableStock < 0).length;
        const violations = negativeDays > 0 ? `⚠️ ${negativeDays} days < 0` : "✅ Clear";

        const p150 = m.estoqueReposicao || 0;
        const suggestion = m.estoqueSugestao || 0;

        report.push(`| ${branch} | ${m.currentPhysical} | ${m.currentAvailable} | ${suggestion.toFixed(1)} | ${p150} | ${m.lostUnits.toFixed(2)} | ${m.ruptureRate.toFixed(2)}% | ${violations} |`);
        
        totalLost += m.lostUnits;
    }

    report.push("");
    report.push(`**Total Potential Lost Sales:** ${totalLost.toFixed(2)} units`);
    report.push("");

    report.push("## 2. Forensic Audit: The Negative Stock Paradox");
    report.push("The system currently allows `availableStock` to drop to -1. This occurs when `physicalStock` is 0 and `VITRINE_LOCAL` is 1.");
    report.push("According to **REGRAS_SAGRADAS_APOLLO.md**, this should be capped at 0 (`Saldo_Disponível = MAX(0, Saldo_Fisico - Saldo_Vitrine)`).");
    report.push("The current engine (v17.3) is leaking negative values into the suggestion logic, which distorts the replenishment priority.");
    report.push("");
    
    report.push("## 3. Suggestion Accuracy Audit");
    report.push("Current suggestion formula: `Sugestão = Disponível - Target`.");
    report.push("For branches in rupture (e.g., Tupis), the suggestion is highly negative (e.g., -5), indicating a critical need.");
    report.push("However, the system needs to prioritize these transfers from **Fábrica**, which itself has a 29% rupture history and only 9 units in stock.");
    report.push("");

    report.push("## 4. Factory Deep Dive (Supply Bottleneck)");
    const factory = results['Fábrica'];
    if (factory) {
        const fTimeline = factory.timeline;
        const recent = fTimeline.slice(-10);
        report.push("Recent Factory Status (Last 10 Days):");
        report.push("");
        report.push("| Date | Physical | Available | Demand | p100 |");
        report.push("| :--- | :---: | :---: | :---: | :---: |");
        recent.forEach(d => {
            const demand = d.instantaneousDemand !== undefined ? d.instantaneousDemand.toFixed(2) : 'N/A';
            const p100 = d.p100 !== undefined ? d.p100.toFixed(2) : 'N/A';
            report.push(`| ${d.date} | ${d.physicalStock} | ${d.availableStock} | ${demand} | ${p100} |`);
        });
    }

    const reportContent = report.join('\n');
    console.log("Report generated.");
    
    // Write to artifact
    fs.writeFileSync('C:/co_ceo/artifacts/sku_49_forensic_report.md', reportContent);
}

analyze();
