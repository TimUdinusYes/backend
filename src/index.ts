import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { learningPathRouter } from './routes/learningPath.js';
import { nodeRouter } from './routes/nodes.js';
import { workflowRouter } from './routes/workflows.js';
import { implementRouter } from './routes/implement.js';
import { quizRouter } from './routes/quiz.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
    origin: process.env.FRONTEND_URL || '*', // Gunakan '*' dulu untuk testing agar tidak kena CORS block
    credentials: true
}));
app.use(express.json());

// PERUBAHAN 1: Tambahkan route untuk root '/' agar tidak "Cannot GET /"
app.get('/', (req, res) => {
    res.send('Backend Server is Running!');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api', learningPathRouter);
app.use('/api', nodeRouter);
app.use('/api', workflowRouter);
app.use('/api', implementRouter);
app.use('/api', quizRouter);

// PERUBAHAN 2: Bungkus app.listen agar hanya jalan di local dev
// Vercel tidak butuh app.listen karena dia menghandle servernya sendiri
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    });
}

// PERUBAHAN 3: WAJIB export app untuk Vercel
export default app;