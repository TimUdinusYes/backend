import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase.js';
import { estimateWorkflowTime } from '../services/aiValidation.js';
import { getGoogleAccessToken, createCalendarEvents, generateLearningSchedule } from '../services/googleCalendar.js';

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

// No longer need OAuth endpoints - Supabase handles auth flow
// Frontend will use Supabase signInWithOAuth({ provider: 'google' })

// Create calendar events for workflow
implementRouter.post('/workflows/:id/implement', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { access_token, start_date, daily_hours } = req.body;

        if (!access_token) {
            res.status(400).json({ success: false, error: 'Google access token required' });
            return;
        }

        console.log('Received request to create calendar events');
        console.log('Workflow ID:', id);
        console.log('Start date:', start_date);
        console.log('Daily hours:', daily_hours);

        const googleAccessToken = access_token;

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

        // Create events in Google Calendar using Google access token
        const result = await createCalendarEvents(googleAccessToken, calendarEvents);

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
        const errorMessage = error instanceof Error ? error.message : 'Failed to create calendar events';
        res.status(500).json({ success: false, error: errorMessage });
    }
});
