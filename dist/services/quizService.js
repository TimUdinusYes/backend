import Groq from 'groq-sdk';
let groqClient = null;
function getGroqClient() {
    if (!groqClient) {
        groqClient = new Groq({
            apiKey: process.env.GROQ_API_KEY
        });
    }
    return groqClient;
}
export async function generateQuizFromContent(materialContent, pageNumber) {
    try {
        const cleanContent = materialContent
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 3000);
        const completion = await getGroqClient().chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah pembuat soal quiz untuk materi pembelajaran. Tugas kamu adalah membuat SATU soal pilihan ganda berdasarkan HANYA dari konten materi yang diberikan.

ATURAN PENTING:
1. Soal HARUS berdasarkan informasi yang ada di dalam materi
2. Jawaban yang benar HARUS ada di dalam materi, jangan membuat informasi baru
3. Buat 4 pilihan jawaban (A, B, C, D)
4. Pastikan hanya ada SATU jawaban yang benar
5. Pilihan jawaban yang salah harus masuk akal tapi jelas salah berdasarkan materi
6. Gunakan Bahasa Indonesia

Jawab HANYA dalam format JSON yang valid:
{
  "question": "Pertanyaan berdasarkan materi",
  "options": ["Pilihan A", "Pilihan B", "Pilihan C", "Pilihan D"],
  "correct_answer": 0
}

Catatan: correct_answer adalah index (0-3) dari jawaban yang benar di array options.`
                },
                {
                    role: 'user',
                    content: `Buatkan 1 soal pilihan ganda untuk halaman ${pageNumber} berdasarkan materi berikut:

${cleanContent}`
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.3,
            max_tokens: 500
        });
        const responseText = completion.choices[0]?.message?.content || '';
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return createDefaultQuiz(pageNumber);
        }
        const result = JSON.parse(jsonMatch[0]);
        if (!result.question || !result.options || result.options.length !== 4 ||
            typeof result.correct_answer !== 'number' || result.correct_answer < 0 || result.correct_answer > 3) {
            return createDefaultQuiz(pageNumber);
        }
        return result;
    }
    catch (error) {
        console.error('Quiz generation error:', error);
        return createDefaultQuiz(pageNumber);
    }
}
function createDefaultQuiz(pageNumber) {
    return {
        question: `Apa yang telah Anda pelajari dari halaman ${pageNumber} materi ini?`,
        options: [
            'Saya memahami konsep dasar yang dijelaskan',
            'Saya belum membaca materi dengan teliti',
            'Materi ini terlalu sulit dipahami',
            'Saya perlu membaca ulang materi ini'
        ],
        correct_answer: 0
    };
}
