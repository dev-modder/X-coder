import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import codeRouter from './pair.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

// Increase max listeners for event emitters
EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/code', codeRouter);

app.get('/pair', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
Don't Forget To Give Star ‼️

Moon Xmd Mini

Server running on http://0.0.0.0:${PORT}`);
});

export default app;
