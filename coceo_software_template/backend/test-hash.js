const bcrypt = require('bcryptjs');

async function testPassword() {
    const password = 'Dani160779!';
    const storedHash = '$2b$10$gLP7un8CsAXTv/oAF/ecg.QFCQ.nbbqXyT.U6y2j/O0B619eodKjoK';

    console.log('Testing password comparison:');
    console.log('Password:', password);
    console.log('Stored Hash:', storedHash);

    const isValid = await bcrypt.compare(password, storedHash);
    console.log('Is Valid:', isValid);

    // Generate a fresh hash
    console.log('\nGenerating fresh hash:');
    const freshHash = await bcrypt.hash(password, 10);
    console.log('Fresh Hash:', freshHash);

    const freshValid = await bcrypt.compare(password, freshHash);
    console.log('Fresh Valid:', freshValid);
}

testPassword();
