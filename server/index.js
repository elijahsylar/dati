const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
require('dotenv').config();

const attachSocketIO = require('./socket');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/themes',    require('./routes/themes'));
app.use('/api/questions',  require('./routes/questions'));
app.use('/api/events',    require('./routes/events'));
app.use('/api/join',      require('./routes/join'));
app.use('/api/lifeline',  require('./routes/lifeline'));
app.use('/api/display',   require('./routes/display'));

// Health check
app.get('/api/health', async (req, res) => {
    const pool = require('./db');
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'error', db: 'disconnected' });
    }
});

// Serve admin UI for any non-API route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = http.createServer(app);
attachSocketIO(server);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🎯 D.A.T.I. Backend running on http://localhost:${PORT}`);
    console.log(`  📱 Admin panel: http://localhost:${PORT}`);
    console.log(`  🔌 Socket.io namespaces: /host, /player, /display`);
    console.log(`  💡 To access from iPad, use your local IP: http://<your-ip>:${PORT}\n`);
});
