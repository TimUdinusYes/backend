export interface QuizQuestion {
    question: string;
    options: string[];
    correct_answer: number;
}
export declare function generateQuizFromContent(materialContent: string, pageNumber: number): Promise<QuizQuestion>;
