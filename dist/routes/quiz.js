import { Router } from 'express';
import { generateQuizFromContent } from '../services/quizService.js';
import { getSupabase } from '../lib/supabase.js';
export const quizRouter = Router();
quizRouter.get('/quiz/:materialId/:pageNumber', async (req, res) => {
    try {
        const { materialId, pageNumber } = req.params;
        const materialIdNum = parseInt(materialId);
        const pageNum = parseInt(pageNumber);
        if (isNaN(materialIdNum) || isNaN(pageNum)) {
            res.status(400).json({
                success: false,
                error: 'Invalid materialId or pageNumber'
            });
            return;
        }
        const { data: existingQuiz } = await getSupabase()
            .from('material_page_quizzes')
            .select('id, question, options, correct_answer')
            .eq('material_id', materialIdNum)
            .eq('page_number', pageNum)
            .single();
        if (existingQuiz) {
            console.log('✅ Quiz found in DB for material:', materialIdNum, 'page:', pageNum);
            res.json({
                success: true,
                quiz: {
                    id: existingQuiz.id,
                    question: existingQuiz.question,
                    options: existingQuiz.options
                },
                fromDatabase: true
            });
            return;
        }
        console.log('🔄 Generating quiz for material:', materialIdNum, 'page:', pageNum);
        const { data: material, error: materialError } = await getSupabase()
            .from('materials')
            .select('pages, content')
            .eq('id', materialIdNum)
            .single();
        if (materialError || !material) {
            res.status(404).json({
                success: false,
                error: 'Material not found'
            });
            return;
        }
        let pageContent = '';
        if (material.pages && material.pages.length >= pageNum) {
            const page = material.pages.find((p) => p.page_number === pageNum);
            pageContent = page?.content || material.pages[pageNum - 1]?.content || '';
        }
        else if (pageNum === 1 && material.content) {
            pageContent = material.content;
        }
        if (!pageContent) {
            res.status(404).json({
                success: false,
                error: 'Page content not found'
            });
            return;
        }
        const generatedQuiz = await generateQuizFromContent(pageContent, pageNum);
        const { data: savedQuiz, error: saveError } = await getSupabase()
            .from('material_page_quizzes')
            .insert({
            material_id: materialIdNum,
            page_number: pageNum,
            question: generatedQuiz.question,
            options: generatedQuiz.options,
            correct_answer: generatedQuiz.correct_answer
        })
            .select('id')
            .single();
        if (saveError) {
            console.error('Error saving quiz:', saveError);
        }
        else {
            console.log('💾 Quiz saved to DB with id:', savedQuiz?.id);
        }
        res.json({
            success: true,
            quiz: {
                id: savedQuiz?.id || 0,
                question: generatedQuiz.question,
                options: generatedQuiz.options
            },
            generated: true
        });
    }
    catch (error) {
        console.error('Get quiz error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get quiz'
        });
    }
});
quizRouter.post('/quiz/submit', async (req, res) => {
    try {
        const { material_id, page_number, user_id, selected_answer } = req.body;
        if (!material_id || !page_number || !user_id || selected_answer === undefined) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
            return;
        }
        const { data: quiz, error: quizError } = await getSupabase()
            .from('material_page_quizzes')
            .select('correct_answer')
            .eq('material_id', material_id)
            .eq('page_number', page_number)
            .single();
        if (quizError || !quiz) {
            res.status(404).json({
                success: false,
                error: 'Quiz not found'
            });
            return;
        }
        const isCorrect = quiz.correct_answer === selected_answer;
        const scoreKey = `${material_id}_${page_number}`;
        const scoreData = {
            score: isCorrect ? 1 : 0,
            answered_at: new Date().toISOString(),
            selected_answer: selected_answer,
            is_correct: isCorrect
        };
        const { data: userProfile } = await getSupabase()
            .from('user_profiles')
            .select('quiz_scores')
            .eq('user_id', user_id)
            .single();
        const currentScores = userProfile?.quiz_scores || {};
        const updatedScores = {
            ...currentScores,
            [scoreKey]: scoreData
        };
        const { error: updateError } = await getSupabase()
            .from('user_profiles')
            .update({ quiz_scores: updatedScores })
            .eq('user_id', user_id);
        if (updateError) {
            console.error('Error updating quiz scores:', updateError);
            res.status(500).json({
                success: false,
                error: 'Failed to save quiz score'
            });
            return;
        }
        console.log('✅ Quiz score saved for user:', user_id, 'material:', material_id, 'page:', page_number, 'correct:', isCorrect);
        res.json({
            success: true,
            is_correct: isCorrect,
            correct_answer: quiz.correct_answer,
            selected_answer: selected_answer
        });
    }
    catch (error) {
        console.error('Submit quiz error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit quiz'
        });
    }
});
quizRouter.get('/quiz/score/:userId/:materialId/:pageNumber', async (req, res) => {
    try {
        const { userId, materialId, pageNumber } = req.params;
        const scoreKey = `${materialId}_${pageNumber}`;
        const { data: userProfile, error } = await getSupabase()
            .from('user_profiles')
            .select('quiz_scores')
            .eq('user_id', userId)
            .single();
        if (error || !userProfile) {
            res.json({
                success: true,
                answered: false
            });
            return;
        }
        const quizScores = userProfile.quiz_scores || {};
        const pageScore = quizScores[scoreKey];
        if (pageScore) {
            res.json({
                success: true,
                answered: true,
                score: pageScore
            });
        }
        else {
            res.json({
                success: true,
                answered: false
            });
        }
    }
    catch (error) {
        console.error('Get quiz score error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get quiz score'
        });
    }
});
