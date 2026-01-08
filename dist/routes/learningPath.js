import { Router } from 'express';
import { validateLearningPath } from '../services/aiValidation.js';
import { getSupabase } from '../lib/supabase.js';
export const learningPathRouter = Router();
// In-memory cache for validation results (expires after 1 hour)
const validationCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
function getCacheKey(fromNode, toNode) {
    return `${fromNode.toLowerCase().trim()}:${toNode.toLowerCase().trim()}`;
}
function getFromCache(fromNode, toNode) {
    const key = getCacheKey(fromNode, toNode);
    const cached = validationCache.get(key);
    if (!cached)
        return null;
    // Check if cache is expired
    if (Date.now() - cached.timestamp > CACHE_TTL) {
        validationCache.delete(key);
        return null;
    }
    return cached.result;
}
function saveToCache(fromNode, toNode, result) {
    const key = getCacheKey(fromNode, toNode);
    validationCache.set(key, {
        result,
        timestamp: Date.now()
    });
}
learningPathRouter.post('/validate-path', async (req, res) => {
    try {
        const { from_node, to_node } = req.body;
        if (!from_node || !to_node) {
            res.status(400).json({
                success: false,
                error: 'from_node and to_node are required'
            });
            return;
        }
        // Normalize names for consistent lookup
        const sourceName = from_node.trim();
        const targetName = to_node.trim();
        // 1. Check node_pair_validations cache by NAME (works across all topics!)
        const { data: cachedValidation } = await getSupabase()
            .from('node_pair_validations')
            .select('is_valid, validation_reason, recommendation')
            .eq('source_name', sourceName)
            .eq('target_name', targetName)
            .single();
        if (cachedValidation) {
            console.log('✅ Validation found in DB cache:', sourceName, '->', targetName, 'is_valid:', cachedValidation.is_valid);
            res.json({
                success: true,
                isValid: cachedValidation.is_valid,
                reason: cachedValidation.validation_reason,
                recommendation: cachedValidation.recommendation,
                fromDatabase: true
            });
            return;
        }
        // 2. Check in-memory cache
        const cachedResult = getFromCache(sourceName, targetName);
        if (cachedResult) {
            console.log('✅ In-memory cache hit for:', sourceName, '->', targetName);
            res.json({
                ...cachedResult,
                fromCache: true
            });
            return;
        }
        // 3. Call AI if not found anywhere
        console.log('🔄 Cache miss, calling AI for:', sourceName, '->', targetName);
        const validation = await validateLearningPath(sourceName, targetName);
        // 4. Save to node_pair_validations by NAME
        const { error: dbError } = await getSupabase()
            .from('node_pair_validations')
            .upsert({
            source_name: sourceName,
            target_name: targetName,
            is_valid: validation.isValid,
            validation_reason: validation.reason,
            recommendation: validation.recommendation || null
        }, {
            onConflict: 'source_name,target_name'
        });
        if (dbError) {
            console.error('Database insert error:', dbError);
        }
        else {
            console.log('💾 Saved validation to DB:', sourceName, '->', targetName);
        }
        // Prepare response
        const response = {
            success: true,
            isValid: validation.isValid,
            reason: validation.reason,
            recommendation: validation.recommendation,
            saved: true
        };
        // Save to in-memory cache
        saveToCache(sourceName, targetName, response);
        res.json(response);
    }
    catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate learning path'
        });
    }
});
