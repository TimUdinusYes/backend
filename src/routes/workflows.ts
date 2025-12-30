import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase.js';

export const workflowRouter = Router();

// Get public workflows (grouped by topic, sorted by stars)
workflowRouter.get('/workflows', async (req: Request, res: Response) => {
    try {
        const { topic_id } = req.query;

        let query = getSupabase()
            .from('workflows')
            .select(`
                *,
                topics (id, title)
            `)
            .eq('is_public', true)
            .eq('is_draft', false)  // Exclude drafts from public listings
            .order('star_count', { ascending: false });

        if (topic_id) {
            query = query.eq('topic_id', topic_id);
        }

        const { data, error } = await query;

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        // Group by topic
        const grouped = data?.reduce((acc: Record<string, typeof data>, workflow) => {
            const topicTitle = (workflow.topics as { title: string })?.title || 'Unknown';
            if (!acc[topicTitle]) acc[topicTitle] = [];
            acc[topicTitle].push(workflow);
            return acc;
        }, {}) || {};

        res.json({ success: true, data, grouped });
    } catch (error) {
        console.error('Fetch workflows error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch workflows' });
    }
});

// Get user's own workflows
workflowRouter.get('/workflows/mine', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'] as string;

        if (!userId) {
            res.status(401).json({ success: false, error: 'User ID required' });
            return;
        }

        const { data, error } = await getSupabase()
            .from('workflows')
            .select(`
                *,
                topics (id, title)
            `)
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('Fetch my workflows error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch workflows' });
    }
});

// Get user's draft workflows
workflowRouter.get('/workflows/drafts', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'] as string;

        if (!userId) {
            res.status(401).json({ success: false, error: 'User ID required' });
            return;
        }

        const { data, error } = await getSupabase()
            .from('workflows')
            .select(`
                *,
                topics (id, title)
            `)
            .eq('user_id', userId)
            .eq('is_draft', true)
            .order('updated_at', { ascending: false });

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('Fetch draft workflows error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch drafts' });
    }
});

// Get workflow detail with edges
workflowRouter.get('/workflows/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] as string;

        const { data: workflow, error } = await getSupabase()
            .from('workflows')
            .select(`
                *,
                topics (id, title)
            `)
            .eq('id', id)
            .single();

        if (error || !workflow) {
            res.status(404).json({ success: false, error: 'Workflow not found' });
            return;
        }

        // Get edges
        const { data: edges } = await getSupabase()
            .from('workflow_edges')
            .select(`
        *,
        source_node:source_node_id (*),
        target_node:target_node_id (*)
      `)
            .eq('workflow_id', id);

        // Check if user has starred
        let hasStarred = false;
        if (userId) {
            const { data: star } = await getSupabase()
                .from('workflow_stars')
                .select('id')
                .eq('workflow_id', id)
                .eq('user_id', userId)
                .single();
            hasStarred = !!star;
        }

        res.json({
            success: true,
            data: {
                ...workflow,
                edges: edges || [],
                hasStarred,
                isOwner: workflow.user_id === userId
            }
        });
    } catch (error) {
        console.error('Fetch workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch workflow' });
    }
});

// Create new workflow
workflowRouter.post('/workflows', async (req: Request, res: Response) => {
    try {
        const { user_id, topic_id, title, description, is_public, is_draft, node_positions, edges } = req.body;

        if (!user_id || !topic_id || !title) {
            res.status(400).json({
                success: false,
                error: 'user_id, topic_id, and title are required'
            });
            return;
        }

        // Create workflow
        const { data: workflow, error } = await getSupabase()
            .from('workflows')
            .insert({
                user_id,
                topic_id,
                title,
                description: description || null,
                is_public: is_public || false,
                is_draft: is_draft !== undefined ? is_draft : false,
                node_positions: node_positions || {}
            })
            .select()
            .single();

        if (error || !workflow) {
            res.status(500).json({ success: false, error: error?.message || 'Failed to create' });
            return;
        }

        // Create edges if provided
        if (edges && edges.length > 0) {
            const edgeData = edges.map((e: { source_node_id: string; target_node_id: string; validation_reason?: string }) => ({
                workflow_id: workflow.id,
                source_node_id: e.source_node_id,
                target_node_id: e.target_node_id,
                validation_reason: e.validation_reason || null
            }));

            await getSupabase()
                .from('workflow_edges')
                .insert(edgeData);
        }

        res.json({ success: true, data: workflow });
    } catch (error) {
        console.error('Create workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to create workflow' });
    }
});

// Update workflow
workflowRouter.put('/workflows/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { title, description, is_public, node_positions, edges } = req.body;

        const { data, error } = await getSupabase()
            .from('workflows')
            .update({
                title,
                description,
                is_public,
                node_positions,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        // Update edges: delete old, insert new
        if (edges) {
            await getSupabase()
                .from('workflow_edges')
                .delete()
                .eq('workflow_id', id);

            if (edges.length > 0) {
                const edgeData = edges.map((e: { source_node_id: string; target_node_id: string; validation_reason?: string }) => ({
                    workflow_id: id,
                    source_node_id: e.source_node_id,
                    target_node_id: e.target_node_id,
                    validation_reason: e.validation_reason || null
                }));

                await getSupabase()
                    .from('workflow_edges')
                    .insert(edgeData);
            }
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('Update workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to update workflow' });
    }
});

// Star workflow
workflowRouter.post('/workflows/:id/star', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] as string || req.body.user_id;

        if (!userId) {
            res.status(401).json({ success: false, error: 'User ID required' });
            return;
        }

        // Check if user owns the workflow
        const { data: workflow } = await getSupabase()
            .from('workflows')
            .select('user_id')
            .eq('id', id)
            .single();

        if (workflow?.user_id === userId) {
            res.status(400).json({ success: false, error: 'Cannot star own workflow' });
            return;
        }

        const { error } = await getSupabase()
            .from('workflow_stars')
            .insert({ workflow_id: id, user_id: userId });

        if (error) {
            if (error.code === '23505') { // Unique violation
                res.status(400).json({ success: false, error: 'Already starred' });
                return;
            }
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Star workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to star workflow' });
    }
});

// Unstar workflow
workflowRouter.delete('/workflows/:id/star', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] as string;

        if (!userId) {
            res.status(401).json({ success: false, error: 'User ID required' });
            return;
        }

        const { error } = await getSupabase()
            .from('workflow_stars')
            .delete()
            .eq('workflow_id', id)
            .eq('user_id', userId);

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Unstar workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to unstar workflow' });
    }
});

// Fork workflow as new
workflowRouter.post('/workflows/:id/fork', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] as string || req.body.user_id;

        if (!userId) {
            res.status(401).json({ success: false, error: 'User ID required' });
            return;
        }

        // Get original workflow
        const { data: original, error: fetchError } = await getSupabase()
            .from('workflows')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !original) {
            res.status(404).json({ success: false, error: 'Workflow not found' });
            return;
        }

        // Create forked workflow
        const { data: forked, error: createError } = await getSupabase()
            .from('workflows')
            .insert({
                user_id: userId,
                topic_id: original.topic_id,
                title: `${original.title} (Forked)`,
                description: original.description,
                is_public: false,
                node_positions: original.node_positions
            })
            .select()
            .single();

        if (createError || !forked) {
            res.status(500).json({ success: false, error: createError?.message || 'Failed to fork' });
            return;
        }

        // Copy edges
        const { data: originalEdges } = await getSupabase()
            .from('workflow_edges')
            .select('*')
            .eq('workflow_id', id);

        if (originalEdges && originalEdges.length > 0) {
            const newEdges = originalEdges.map(e => ({
                workflow_id: forked.id,
                source_node_id: e.source_node_id,
                target_node_id: e.target_node_id,
                validation_reason: e.validation_reason
            }));

            await getSupabase()
                .from('workflow_edges')
                .insert(newEdges);
        }

        res.json({ success: true, data: forked });
    } catch (error) {
        console.error('Fork workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to fork workflow' });
    }
});

// Delete workflow
workflowRouter.delete('/workflows/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { error } = await getSupabase()
            .from('workflows')
            .delete()
            .eq('id', id);

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete workflow' });
    }
});
