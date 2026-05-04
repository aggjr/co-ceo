try { require('./server.js'); } catch (e) { require('fs').writeFileSync('err.txt', e.stack); }
