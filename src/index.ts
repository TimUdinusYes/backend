// Load env vars first, before any imports that might use them
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
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api', learningPathRouter);
app.use('/api', nodeRouter);
app.use('/api', workflowRouter);
app.use('/api', implementRouter);
app.use('/api', quizRouter);

app.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});
