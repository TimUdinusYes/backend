import { Router } from 'express';
import { getSupabase } from '../lib/supabase.js';
import { extractNodesFromTopic, validateLearningPath } from '../services/aiValidation.js';
export const workflowRouter = Router();
// Get public workflows (grouped by topic, sorted by stars)
workflowRouter.get('/workflows', async (req, res) => {
    try {
        const { topic_id } = req.query;
        let query = getSupabase()
            .from('workflows')
            .select(`
                *,
                topics:topic_id (id, title)
            `)
            .eq('is_public', true)
            .eq('is_draft', false) // Exclude drafts from public listings
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
        const grouped = data?.reduce((acc, workflow) => {
            const topicTitle = workflow.topics?.title || 'Unknown';
            if (!acc[topicTitle])
                acc[topicTitle] = [];
            acc[topicTitle].push(workflow);
            return acc;
        }, {}) || {};
        res.json({ success: true, data, grouped });
    }
    catch (error) {
        console.error('Fetch workflows error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch workflows' });
    }
});
// Get user's own workflows
workflowRouter.get('/workflows/mine', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            res.status(401).json({ success: false, error: 'User ID required' });
            return;
        }
        const { data, error } = await getSupabase()
            .from('workflows')
            .select(`
                *,
                topics:topic_id (id, title)
            `)
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });
        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('Fetch my workflows error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch workflows' });
    }
});
// Get user's draft workflows
workflowRouter.get('/workflows/drafts', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            res.status(401).json({ success: false, error: 'User ID required' });
            return;
        }
        const { data, error } = await getSupabase()
            .from('workflows')
            .select(`
                *,
                topics:topic_id (id, title)
            `)
            .eq('user_id', userId)
            .eq('is_draft', true)
            .order('updated_at', { ascending: false });
        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('Fetch draft workflows error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch drafts' });
    }
});
// Get workflow detail with edges
workflowRouter.get('/workflows/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'];
        const { data: workflow, error } = await getSupabase()
            .from('workflows')
            .select(`
                *,
                topics:topic_id (id, title)
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
        // Enrich edges with validation data from cache
        const enrichedEdges = await Promise.all((edges || []).map(async (edge) => {
            const sourceNode = edge.source_node;
            const targetNode = edge.target_node;
            if (sourceNode?.title && targetNode?.title) {
                const { data: validation } = await getSupabase()
                    .from('node_pair_validations')
                    .select('is_valid, validation_reason, recommendation')
                    .eq('source_name', sourceNode.title)
                    .eq('target_name', targetNode.title)
                    .single();
                if (validation) {
                    return {
                        ...edge,
                        is_valid: validation.is_valid,
                        validation_reason: validation.validation_reason,
                        recommendation: validation.recommendation
                    };
                }
            }
            return edge;
        }));
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
                edges: enrichedEdges,
                hasStarred,
                isOwner: workflow.user_id === userId
            }
        });
    }
    catch (error) {
        console.error('Fetch workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch workflow' });
    }
});
// Create new workflow
workflowRouter.post('/workflows', async (req, res) => {
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
        // Create edges if provided (validation data is now in cache)
        if (edges && edges.length > 0) {
            const edgeData = edges.map((e) => ({
                workflow_id: workflow.id,
                source_node_id: e.source_node_id,
                target_node_id: e.target_node_id
            }));
            await getSupabase()
                .from('workflow_edges')
                .insert(edgeData);
        }
        res.json({ success: true, data: workflow });
    }
    catch (error) {
        console.error('Create workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to create workflow' });
    }
});
// Update workflow
workflowRouter.put('/workflows/:id', async (req, res) => {
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
                const edgeData = edges.map((e) => ({
                    workflow_id: id,
                    source_node_id: e.source_node_id,
                    target_node_id: e.target_node_id
                }));
                await getSupabase()
                    .from('workflow_edges')
                    .insert(edgeData);
            }
        }
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('Update workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to update workflow' });
    }
});
// Star workflow
workflowRouter.post('/workflows/:id/star', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] || req.body.user_id;
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
    }
    catch (error) {
        console.error('Star workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to star workflow' });
    }
});
// Unstar workflow
workflowRouter.delete('/workflows/:id/star', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'];
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
    }
    catch (error) {
        console.error('Unstar workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to unstar workflow' });
    }
});
// Fork workflow as new
workflowRouter.post('/workflows/:id/fork', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] || req.body.user_id;
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
        // Copy edges (validation data is now from cache on GET)
        const { data: originalEdges } = await getSupabase()
            .from('workflow_edges')
            .select('source_node_id, target_node_id')
            .eq('workflow_id', id);
        if (originalEdges && originalEdges.length > 0) {
            const newEdges = originalEdges.map(e => ({
                workflow_id: forked.id,
                source_node_id: e.source_node_id,
                target_node_id: e.target_node_id
            }));
            await getSupabase()
                .from('workflow_edges')
                .insert(newEdges);
        }
        // Fetch complete forked workflow with edges (validation will be enriched on GET)
        const { data: edges } = await getSupabase()
            .from('workflow_edges')
            .select(`
                *,
                source_node:source_node_id (*),
                target_node:target_node_id (*)
            `)
            .eq('workflow_id', forked.id);
        console.log('📤 Forked workflow with', edges?.length || 0, 'edges');
        res.json({
            success: true,
            data: {
                ...forked,
                edges: edges || []
            }
        });
    }
    catch (error) {
        console.error('Fork workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to fork workflow' });
    }
});
// Delete workflow
workflowRouter.delete('/workflows/:id', async (req, res) => {
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
    }
    catch (error) {
        console.error('Delete workflow error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete workflow' });
    }
});
// Convert topic to workflow with AI
workflowRouter.post('/topics/:topicId/convert-to-workflow', async (req, res) => {
    try {
        const { topicId } = req.params;
        const userId = req.headers['x-user-id'] || req.body.user_id;
        if (!userId) {
            res.status(401).json({ success: false, error: 'User ID required' });
            return;
        }
        // Get topic details
        const { data: topic, error: topicError } = await getSupabase()
            .from('topics')
            .select('*')
            .eq('id', topicId)
            .single();
        if (topicError || !topic) {
            res.status(404).json({ success: false, error: 'Topic not found' });
            return;
        }
        // Check if already converted
        if (topic.is_converted && topic.converted_workflow_id) {
            // Get existing workflow
            const { data: existingWorkflow, error: workflowError } = await getSupabase()
                .from('workflows')
                .select(`
                    *,
                    topics:topic_id (id, title)
                `)
                .eq('id', topic.converted_workflow_id)
                .single();
            if (!workflowError && existingWorkflow) {
                // Get edges
                const { data: edges } = await getSupabase()
                    .from('workflow_edges')
                    .select(`
                        *,
                        source_node:source_node_id (*),
                        target_node:target_node_id (*)
                    `)
                    .eq('workflow_id', existingWorkflow.id);
                console.log('📤 Sending cached converted workflow with edges:', edges?.map(e => ({
                    source: e.source_node?.title,
                    target: e.target_node?.title,
                    validation_reason: e.validation_reason
                })));
                res.json({
                    success: true,
                    fromCache: true,
                    data: {
                        ...existingWorkflow,
                        edges: edges || []
                    }
                });
                return;
            }
        }
        // AI conversion
        const conversionResult = await extractNodesFromTopic(topic.title, topic.description);
        // Create nodes in database
        const nodeData = conversionResult.nodes.map(node => ({
            topic_id: parseInt(topicId),
            title: node.title,
            description: node.description,
            color: node.color,
            created_by: userId
        }));
        const { data: createdNodes, error: nodesError } = await getSupabase()
            .from('learning_nodes')
            .insert(nodeData)
            .select();
        if (nodesError || !createdNodes) {
            res.status(500).json({ success: false, error: 'Failed to create nodes' });
            return;
        }
        // Calculate node positions for auto-layout (vertical flow)
        const nodePositions = {};
        createdNodes.forEach((node, index) => {
            nodePositions[node.id] = {
                x: 250,
                y: index * 150 + 100
            };
        });
        // Create workflow
        const { data: workflow, error: workflowError } = await getSupabase()
            .from('workflows')
            .insert({
            user_id: userId,
            topic_id: parseInt(topicId),
            title: `Learning Path: ${topic.title}`,
            description: conversionResult.summary,
            is_public: false,
            node_positions: nodePositions
        })
            .select()
            .single();
        if (workflowError || !workflow) {
            res.status(500).json({ success: false, error: 'Failed to create workflow' });
            return;
        }
        // Create edges and save validation to cache by NAME
        if (conversionResult.edges && conversionResult.edges.length > 0) {
            const edgeData = await Promise.all(conversionResult.edges.map(async (edge) => {
                const sourceNode = createdNodes[edge.from];
                const targetNode = createdNodes[edge.to];
                // Check cache by NAME first
                const { data: cachedValidation } = await getSupabase()
                    .from('node_pair_validations')
                    .select('is_valid, validation_reason, recommendation')
                    .eq('source_name', sourceNode.title)
                    .eq('target_name', targetNode.title)
                    .single();
                if (!cachedValidation) {
                    // Generate validation and save to cache by NAME
                    console.log('🤖 Generating validation for:', sourceNode.title, '->', targetNode.title);
                    const validation = await validateLearningPath(sourceNode.title, targetNode.title);
                    await getSupabase()
                        .from('node_pair_validations')
                        .upsert({
                        source_name: sourceNode.title,
                        target_name: targetNode.title,
                        is_valid: validation.isValid,
                        validation_reason: validation.reason,
                        recommendation: validation.recommendation || null
                    }, {
                        onConflict: 'source_name,target_name'
                    });
                }
                else {
                    console.log('✅ Using cached validation for:', sourceNode.title, '->', targetNode.title);
                }
                // Edge only contains references (validation from cache on GET)
                return {
                    workflow_id: workflow.id,
                    source_node_id: sourceNode.id,
                    target_node_id: targetNode.id
                };
            }));
            await getSupabase()
                .from('workflow_edges')
                .insert(edgeData);
        }
        // Update topic as converted
        await getSupabase()
            .from('topics')
            .update({
            is_converted: true,
            converted_workflow_id: workflow.id
        })
            .eq('id', topicId);
        // Fetch complete workflow with edges
        const { data: edges } = await getSupabase()
            .from('workflow_edges')
            .select(`
                *,
                source_node:source_node_id (*),
                target_node:target_node_id (*)
            `)
            .eq('workflow_id', workflow.id);
        console.log('📤 Sending converted workflow with edges:', edges?.map(e => ({
            source: e.source_node?.title,
            target: e.target_node?.title,
            validation_reason: e.validation_reason
        })));
        res.json({
            success: true,
            fromCache: false,
            data: {
                ...workflow,
                edges: edges || [],
                topics: { id: topic.id, title: topic.title }
            }
        });
    }
    catch (error) {
        console.error('Convert topic error:', error);
        res.status(500).json({ success: false, error: 'Failed to convert topic' });
    }
});
