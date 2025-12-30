import { Router, Request, Response } from 'express';
import { validateLearningPath } from '../services/aiValidation.js';
import { getSupabase } from '../lib/supabase.js';

export const learningPathRouter = Router();

interface ValidatePathBody {
    from_node: string;
    to_node: string;
    user_id: string;
}

learningPathRouter.post('/validate-path', async (req: Request, res: Response) => {
    try {
        const { from_node, to_node, user_id } = req.body as ValidatePathBody;

        if (!from_node || !to_node) {
            res.status(400).json({
                success: false,
                error: 'from_node and to_node are required'
            });
            return;
        }

        const validation = await validateLearningPath(from_node, to_node);

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

            res.json({
                success: true,
                isValid: true,
                reason: validation.reason,
                saved: !!user_id
            });
        } else {
            res.json({
                success: true,
                isValid: false,
                reason: validation.reason,
                recommendation: validation.recommendation
            });
        }

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
