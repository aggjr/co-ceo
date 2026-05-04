const axios = require('axios');

async function testLogin() {
    try {
        console.log('Tentando login com axios...');
        const response = await axios.post('http://localhost:3001/api/auth/login', {
            email: 'admin@vortex.com.br',
            password: 'Dani160779!'
        });
        console.log('Login com sucesso!');
        console.log('Status:', response.status);
        console.log('Token:', response.data.token ? 'Presente' : 'Ausente');
        console.log('User:', response.data.user);
    } catch (error) {
        console.error('Erro no login:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

testLogin();
