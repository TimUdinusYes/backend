import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase.js';
import { estimateWorkflowTime } from '../services/aiValidation.js';
import { getAuthUrl, getTokenFromCode, createCalendarEvents, generateLearningSchedule } from '../services/googleCalendar.js';

export const implementRouter = Router();

// Get time estimate for a workflow
implementRouter.post('/workflows/:id/estimate', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Get workflow edges with node data
        const { data: edges, error } = await getSupabase()
            .from('workflow_edges')
            .select(`
                source_node:source_node_id (id, title, description),
                target_node:target_node_id (id, title, description)
            `)
            .eq('workflow_id', id);

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        // Extract unique nodes
        const nodeMap = new Map<string, { id: string; title: string; description?: string | null }>();
        edges?.forEach(edge => {
            const source = edge.source_node as unknown as { id: string; title: string; description?: string };
            const target = edge.target_node as unknown as { id: string; title: string; description?: string };
            if (source) nodeMap.set(source.id, source);
            if (target) nodeMap.set(target.id, target);
        });

        const nodes = Array.from(nodeMap.values());

        if (nodes.length === 0) {
            res.status(400).json({ success: false, error: 'Workflow has no nodes' });
            return;
        }

        // Get AI estimate
        const schedule = await estimateWorkflowTime(nodes);

        res.json({ success: true, data: schedule });
    } catch (error) {
        console.error('Estimate error:', error);
        res.status(500).json({ success: false, error: 'Failed to estimate workflow' });
    }
});

// Estimate nodes directly (for unsaved workflows)
implementRouter.post('/estimate-nodes', async (req: Request, res: Response) => {
    try {
        const { nodes } = req.body;

        if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
            res.status(400).json({ success: false, error: 'Nodes array required' });
            return;
        }

        // Get AI estimate
        const schedule = await estimateWorkflowTime(nodes);

        res.json({ success: true, data: schedule });
    } catch (error) {
        console.error('Estimate nodes error:', error);
        res.status(500).json({ success: false, error: 'Failed to estimate nodes' });
    }
});

// Get Google OAuth URL
implementRouter.get('/auth/google/url', (req: Request, res: Response) => {
    try {
        const url = getAuthUrl();
        res.json({ success: true, url });
    } catch (error) {
        console.error('OAuth URL error:', error);
        res.status(500).json({ success: false, error: 'Google OAuth not configured' });
    }
});

// Google OAuth callback
implementRouter.get('/auth/google/callback', async (req: Request, res: Response) => {
    try {
        const { code } = req.query;

        if (!code || typeof code !== 'string') {
            res.status(400).json({ success: false, error: 'Missing code' });
            return;
        }

        const tokens = await getTokenFromCode(code);

        // Redirect back to frontend with token
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/n8n-workflow?google_token=${tokens.access_token}`);
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).json({ success: false, error: 'Failed to get token' });
    }
});

// Create calendar events for workflow
implementRouter.post('/workflows/:id/implement', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { access_token, start_date, daily_hours } = req.body;

        if (!access_token) {
            res.status(400).json({ success: false, error: 'Google access token required' });
            return;
        }

        // Get workflow edges with node data
        const { data: edges } = await getSupabase()
            .from('workflow_edges')
            .select(`
                source_node:source_node_id (id, title, description),
                target_node:target_node_id (id, title, description)
            `)
            .eq('workflow_id', id);

        // Extract unique nodes
        const nodeMap = new Map<string, { id: string; title: string; description?: string | null }>();
        edges?.forEach(edge => {
            const source = edge.source_node as unknown as { id: string; title: string; description?: string };
            const target = edge.target_node as unknown as { id: string; title: string; description?: string };
            if (source) nodeMap.set(source.id, source);
            if (target) nodeMap.set(target.id, target);
        });

        const nodes = Array.from(nodeMap.values());

        // Get time estimates
        const schedule = await estimateWorkflowTime(nodes);

        // Generate calendar events
        const startDate = start_date ? new Date(start_date) : new Date();
        startDate.setHours(9, 0, 0, 0); // Start at 9 AM

        const calendarEvents = generateLearningSchedule(
            schedule.nodes,
            startDate,
            daily_hours || schedule.suggestedDailyHours
        );

        // Create events in Google Calendar
        const result = await createCalendarEvents(access_token, calendarEvents);

        res.json({
            success: true,
            data: {
                schedule,
                eventCount: result.eventIds.length,
                message: `${result.eventIds.length} events created in Google Calendar`
            }
        });
    } catch (error) {
        console.error('Implement error:', error);
        res.status(500).json({ success: false, error: 'Failed to create calendar events' });
    }
});
