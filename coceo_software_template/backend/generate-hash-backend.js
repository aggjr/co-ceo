const bcrypt = require('bcryptjs');

async function generate() {
    const password = 'Dani160779!';
    const hash = await bcrypt.hash(password, 10);
    console.log('Password:', password);
    console.log('Hash:', hash);

    // Test compare immediately
    const valid = await bcrypt.compare(password, hash);
    console.log('Compare check:', valid);
}

generate();
