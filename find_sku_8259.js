const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'data', 'js');
fs.readdirSync(dir).forEach(f => {
    if (f.startsWith('sku_')) {
        try {
            const content = fs.readFileSync(path.join(dir, f), 'utf8');
            if (content.includes('"code":8259') || content.includes('"code":"8259"')) {
                console.log(f);
            }
        } catch (e) {}
    }
});
