const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
require('dotenv').config();

// Import local middleware
const { auth } = require('./middleware/auth');
const errorHandler = require('./middleware/errorMiddleware');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    console.log(`LOG: [Socket] Client connected: ${socket.id}`);

    socket.on("disconnect", (reason) => {
        console.log(`LOG: [Socket] Client disconnected: ${socket.id}, Reason: ${reason}`);
    });
});

// Share io instance via app
app.set('io', io);

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

// GLOBAL REQUEST LOGGER
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// API Router
const apiRouter = express.Router();

// Force UTF-8 encoding for API responses
apiRouter.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// Routes
const authRoutes = require('./routes/auth');
const tenantRoutes = require('./routes/tenants');
const userRoutes = require('./routes/users');
const rbacRoutes = require('./routes/rbac');

apiRouter.use('/auth', authRoutes);
apiRouter.use('/tenants', tenantRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/rbac', rbacRoutes);
const planRoutes = require('./routes/plans');
apiRouter.use('/plans', planRoutes);
const stockspinRoutes = require('./modules/stockspin/index');
apiRouter.use('/stockspin', stockspinRoutes);
// TODO: Add more routes as modules are implemented
// apiRouter.use('/produtos', require('./routes/produtos'));
// apiRouter.use('/fornecedores', require('./routes/fornecedores'));
// apiRouter.use('/producao', require('./routes/producao'));
// apiRouter.use('/estoque', require('./routes/estoque'));

// Mount API routes
app.use('/api', apiRouter);

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date(),
        service: 'CO-CEO Backend',
        version: '0.1.89'
    });
});

// Static Uploads Serving
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Dados estáticos do STOCKSPIN (catalog_grid.js, curtain, etc.) ──────────
// Volume montado no Easypanel: /root/dados_stockspin (host) → /dados_stockspin (container)
// URL de acesso: https://co-ceo.com.br/stockspin-data/data/catalog_grid.js
const STOCKSPIN_DATA_DIR = process.env.STOCKSPIN_DATA_DIR || '/dados_stockspin';
app.use('/stockspin-data', (req, res, next) => {
    // Bloqueia path traversal
    if (req.path.includes('..')) return res.status(403).send('Forbidden');
    next();
}, express.static(STOCKSPIN_DATA_DIR, {
    setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
    }
}));

// Serve static files from the frontend
const frontendPath = path.join(__dirname, 'public');
app.use(express.static(frontendPath));

// Handle SPA fallback
app.get('*', (req, res, next) => {
    if (req.url.startsWith('/api')) {
        return next();
    }
    const indexFile = path.join(frontendPath, 'index.html');
    res.sendFile(indexFile, (err) => {
        if (err) {
            res.status(404).json({ error: 'Frontend not found or 404' });
        }
    });
});

// Error handling middleware
app.use(errorHandler);

// 404 for unknown API routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

// Start server
function startServer() {
    if (app.serverInstance) return;

    app.serverInstance = server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n========================================`);
        console.log(`CO-CEO Backend API Server (with WebSockets)`);
        console.log(`========================================`);
        console.log(`⏰ Started at: ${new Date().toISOString()}`);
        console.log(`🌍 Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
        console.log(`📡 Server running on: http://localhost:${PORT}`);
        console.log(`🏥 Health check: http://localhost:${PORT}/health`);
        console.log(`========================================\n`);
    });
}

// Start server immediately
startServer();

module.exports = app;
