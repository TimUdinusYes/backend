import { Router, Request, Response } from 'express';
import { validateLearningPath } from '../services/aiValidation.js';
import { getSupabase } from '../lib/supabase.js';

export const learningPathRouter = Router();

interface ValidatePathBody {
    from_node: string;
    to_node: string;
    user_id: string;
    source_node_id?: string;
    target_node_id?: string;
    workflow_id?: string;
}

// In-memory cache for validation results (expires after 1 hour)
const validationCache = new Map<string, { result: any; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

function getCacheKey(fromNode: string, toNode: string): string {
    return `${fromNode.toLowerCase().trim()}:${toNode.toLowerCase().trim()}`;
}

function getFromCache(fromNode: string, toNode: string) {
    const key = getCacheKey(fromNode, toNode);
    const cached = validationCache.get(key);

    if (!cached) return null;

    // Check if cache is expired
    if (Date.now() - cached.timestamp > CACHE_TTL) {
        validationCache.delete(key);
        return null;
    }

    return cached.result;
}

function saveToCache(fromNode: string, toNode: string, result: any) {
    const key = getCacheKey(fromNode, toNode);
    validationCache.set(key, {
        result,
        timestamp: Date.now()
    });
}

learningPathRouter.post('/validate-path', async (req: Request, res: Response) => {
    try {
        const { from_node, to_node, user_id, source_node_id, target_node_id } = req.body as ValidatePathBody;

        if (!from_node || !to_node) {
            res.status(400).json({
                success: false,
                error: 'from_node and to_node are required'
            });
            return;
        }

        // 1. Check if validation_reason already exists in workflow_edges (priority tertinggi)
        if (source_node_id && target_node_id) {
            // Cari di workflow_edges untuk kombinasi node ini (dari workflow manapun)
            // Karena validasi node A -> node B seharusnya konsisten across workflows
            const { data: existingEdges } = await getSupabase()
                .from('workflow_edges')
                .select('validation_reason, workflow_id')
                .eq('source_node_id', source_node_id)
                .eq('target_node_id', target_node_id)
                .not('validation_reason', 'is', null)
                .limit(1);

            if (existingEdges && existingEdges.length > 0 && existingEdges[0].validation_reason) {
                console.log('✅ Validation reason found in workflow_edges (from any workflow):', from_node, '->', to_node);
                res.json({
                    success: true,
                    isValid: true,
                    reason: existingEdges[0].validation_reason,
                    fromDatabase: true
                });
                return;
            }
        }

        // 2. Check cache
        const cachedResult = getFromCache(from_node, to_node);
        if (cachedResult) {
            console.log('✅ Cache hit for:', from_node, '->', to_node);
            res.json({
                ...cachedResult,
                fromCache: true
            });
            return;
        }

        // 3. Call AI if not found anywhere
        console.log('🔄 Cache miss, calling AI for:', from_node, '->', to_node);
        const validation = await validateLearningPath(from_node, to_node);

        // Prepare response
        let response;
        if (validation.isValid) {
            if (user_id) {
                const { error: dbError } = await getSupabase()
                    .from('user_learning_paths')
                    .insert({
                        user_id,
                        from_node,
                        to_node,
                        is_valid: true,
                        validation_reason: validation.reason
                    });

                if (dbError) {
                    console.error('Database insert error:', dbError);
                }
            }

            response = {
                success: true,
                isValid: true,
                reason: validation.reason,
                saved: !!user_id
            };
        } else {
            response = {
                success: true,
                isValid: false,
                reason: validation.reason,
                recommendation: validation.recommendation
            };
        }

        // Save to cache
        saveToCache(from_node, to_node, response);

        res.json(response);

    } catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate learning path'
        });
    }
});

learningPathRouter.get('/learning-paths/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        const { data, error } = await getSupabase()
            .from('user_learning_paths')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true, data });

    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch learning paths' });
    }
});

learningPathRouter.delete('/learning-paths/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { error } = await getSupabase()
            .from('user_learning_paths')
            .delete()
            .eq('id', id);

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete learning path' });
    }
});
