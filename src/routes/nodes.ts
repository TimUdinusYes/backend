import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase.js';
import { checkDuplicateNode } from '../services/aiValidation.js';

export const nodeRouter = Router();

// Get nodes by topic (sorted by usage count)
nodeRouter.get('/nodes/:topicId', async (req: Request, res: Response) => {
    try {
        const { topicId } = req.params;

        const { data, error } = await getSupabase()
            .from('learning_nodes')
            .select('*')
            .eq('topic_id', topicId)
            .order('usage_count', { ascending: false });

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('Fetch nodes error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch nodes' });
    }
});

// Create new node with AI duplicate check
nodeRouter.post('/nodes', async (req: Request, res: Response) => {
    try {
        const { topic_id, title, description, color, user_id } = req.body;

        if (!topic_id || !title) {
            res.status(400).json({
                success: false,
                error: 'topic_id and title are required'
            });
            return;
        }

        // Get existing nodes for the topic
        const { data: existingNodes } = await getSupabase()
            .from('learning_nodes')
            .select('id, title, description')
            .eq('topic_id', topic_id);

        // Check for duplicates using AI
        if (existingNodes && existingNodes.length > 0) {
            const duplicateCheck = await checkDuplicateNode(title, existingNodes);

            if (duplicateCheck.isDuplicate) {
                res.json({
                    success: false,
                    isDuplicate: true,
                    reason: duplicateCheck.reason,
                    similarNode: duplicateCheck.similarNode
                });
                return;
            }
        }

        // Create the node (no icon field anymore)
        const { data, error } = await getSupabase()
            .from('learning_nodes')
            .insert({
                topic_id,
                title,
                description: description || null,
                color: color || '#6366f1',
                created_by: user_id || null
            })
            .select()
            .single();

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('Create node error:', error);
        res.status(500).json({ success: false, error: 'Failed to create node' });
    }
});

// Increment node usage count
nodeRouter.patch('/nodes/:id/increment-usage', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { error } = await getSupabase()
            .rpc('increment_node_usage', { node_id: id });

        if (error) {
            // Fallback if RPC doesn't exist
            const { error: updateError } = await getSupabase()
                .from('learning_nodes')
                .update({ usage_count: getSupabase().rpc('increment', { x: 1 }) })
                .eq('id', id);

            if (updateError) {
                res.status(500).json({ success: false, error: updateError.message });
                return;
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Increment usage error:', error);
        res.status(500).json({ success: false, error: 'Failed to increment usage' });
    }
});
