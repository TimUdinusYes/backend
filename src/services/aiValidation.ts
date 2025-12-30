import Groq from 'groq-sdk';

let groqClient: Groq | null = null;

function getGroqClient(): Groq {
    if (!groqClient) {
        groqClient = new Groq({
            apiKey: process.env.GROQ_API_KEY
        });
    }
    return groqClient;
}

export interface ValidationResult {
    isValid: boolean;
    reason: string;
    recommendation?: string;
}

export async function validateLearningPath(
    fromNode: string,
    toNode: string
): Promise<ValidationResult> {
    try {
        const completion = await getGroqClient().chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah ahli pedagogi dan kurikulum pendidikan. Tugas kamu adalah mengevaluasi apakah urutan pembelajaran antara dua topik masuk akal secara pedagogis.

Pertimbangkan:
1. Apakah topik pertama merupakan prasyarat logis untuk topik kedua?
2. Apakah konsep-konsep di topik pertama diperlukan untuk memahami topik kedua?
3. Apakah tingkat kesulitan progresif dari topik pertama ke topik kedua?

Jawab HANYA dalam format JSON yang valid seperti ini:
{"isValid": true, "reason": "Alasan singkat mengapa urutan ini baik"}

atau jika tidak valid:
{"isValid": false, "reason": "Alasan mengapa urutan ini tidak tepat", "recommendation": "Topik apa yang sebaiknya dipelajari terlebih dahulu"}`
                },
                {
                    role: 'user',
                    content: `Seorang siswa ingin belajar materi "${toNode}" setelah mempelajari "${fromNode}". Apakah urutan ini masuk akal secara pedagogis?`
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.3,
            max_tokens: 500
        });

        const responseText = completion.choices[0]?.message?.content || '';

        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return {
                isValid: true,
                reason: 'Tidak dapat memvalidasi urutan pembelajaran.'
            };
        }

        const result = JSON.parse(jsonMatch[0]) as ValidationResult;
        return result;

    } catch (error) {
        console.error('AI validation error:', error);
        return {
            isValid: true,
            reason: 'Gagal memvalidasi urutan pembelajaran. Koneksi diizinkan secara default.'
        };
    }
}

export interface DuplicateCheckResult {
    isDuplicate: boolean;
    reason: string;
    similarNode?: {
        id: string;
        title: string;
    };
}

export async function checkDuplicateNode(
    newTitle: string,
    existingNodes: Array<{ id: string; title: string; description?: string | null }>
): Promise<DuplicateCheckResult> {
    try {
        const nodeList = existingNodes.map(n => `- ${n.title}${n.description ? `: ${n.description}` : ''}`).join('\n');

        const completion = await getGroqClient().chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah asisten yang membantu mencegah duplikasi PERSIS dalam sistem pembelajaran.

PENTING: Hanya tandai sebagai duplikat jika node baru PERSIS SAMA atau hanya berbeda sedikit penulisan dengan yang sudah ada.

Contoh yang BUKAN duplikat (izinkan):
- "JavaScript" dan "React" = BUKAN duplikat (React adalah library, JavaScript adalah bahasa)
- "Python" dan "Machine Learning" = BUKAN duplikat (berbeda konsep)
- "HTML" dan "CSS" = BUKAN duplikat (teknologi berbeda)
- "Database" dan "SQL" = BUKAN duplikat (SQL adalah bahasa query)

Contoh yang DUPLIKAT (tolak):
- "JavaScript" dan "Javascript" = DUPLIKAT (penulisan berbeda)
- "React JS" dan "ReactJS" = DUPLIKAT (sama persis)
- "Machine Learning" dan "ML" = DUPLIKAT (singkatan)

Node yang sudah ada:
${nodeList}

Jawab HANYA dalam format JSON:
{"isDuplicate": false, "reason": "Node ini unik dan berbeda dari yang sudah ada"}

atau jika PERSIS duplikat:
{"isDuplicate": true, "reason": "Alasan mengapa duplikat", "similarNodeTitle": "Judul node yang mirip"}`
                },
                {
                    role: 'user',
                    content: `Apakah node baru "${newTitle}" merupakan duplikat PERSIS dari node yang sudah ada?`
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            max_tokens: 300
        });

        const responseText = completion.choices[0]?.message?.content || '';
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            return { isDuplicate: false, reason: 'Tidak dapat memeriksa duplikasi.' };
        }

        const result = JSON.parse(jsonMatch[0]);

        if (result.isDuplicate && result.similarNodeTitle) {
            const similarNode = existingNodes.find(n =>
                n.title.toLowerCase() === result.similarNodeTitle.toLowerCase()
            );
            return {
                isDuplicate: true,
                reason: result.reason,
                similarNode: similarNode ? { id: similarNode.id, title: similarNode.title } : undefined
            };
        }

        return { isDuplicate: false, reason: result.reason };

    } catch (error) {
        console.error('Duplicate check error:', error);
        return { isDuplicate: false, reason: 'Gagal memeriksa duplikasi.' };
    }
}

export interface NodeTimeEstimate {
    nodeId: string;
    nodeTitle: string;
    estimatedHours: number;
    description: string;
}

export interface WorkflowSchedule {
    totalHours: number;
    nodes: NodeTimeEstimate[];
    suggestedDailyHours: number;
    totalDays: number;
}

export async function estimateWorkflowTime(
    nodes: Array<{ id: string; title: string; description?: string | null }>
): Promise<WorkflowSchedule> {
    try {
        const nodeList = nodes.map(n => `- ${n.title}${n.description ? `: ${n.description}` : ''}`).join('\n');

        const completion = await getGroqClient().chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah ahli kurikulum pendidikan. Berikan estimasi waktu belajar realistis untuk setiap topik.

Topik yang akan dipelajari:
${nodeList}

Pertimbangkan:
1. Kompleksitas topik
2. Waktu untuk latihan dan praktek
3. Waktu untuk mendalami konsep

Berikan estimasi dalam JAM untuk setiap topik. Estimasi yang realistis biasanya:
- Topik dasar: 2-5 jam
- Topik menengah: 5-15 jam  
- Topik lanjutan: 15-40 jam

Jawab HANYA dalam format JSON:
{
  "nodes": [
    {"title": "Nama Topik", "hours": 10, "description": "Penjelasan singkat apa yang dipelajari"}
  ],
  "suggestedDailyHours": 2,
  "summary": "Ringkasan singkat jadwal belajar"
}`
                },
                {
                    role: 'user',
                    content: `Berikan estimasi waktu belajar untuk workflow dengan ${nodes.length} topik di atas.`
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.3,
            max_tokens: 1000
        });

        const responseText = completion.choices[0]?.message?.content || '';
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            // Return default estimates
            return createDefaultEstimate(nodes);
        }

        const result = JSON.parse(jsonMatch[0]);

        // Map AI response to our format
        const nodeEstimates: NodeTimeEstimate[] = nodes.map((node, i) => {
            const aiNode = result.nodes?.find((n: { title: string }) =>
                n.title.toLowerCase().includes(node.title.toLowerCase()) ||
                node.title.toLowerCase().includes(n.title.toLowerCase())
            ) || result.nodes?.[i];

            return {
                nodeId: node.id,
                nodeTitle: node.title,
                estimatedHours: aiNode?.hours || 5,
                description: aiNode?.description || `Pelajari ${node.title}`
            };
        });

        const totalHours = nodeEstimates.reduce((sum, n) => sum + n.estimatedHours, 0);
        const suggestedDailyHours = result.suggestedDailyHours || 2;

        return {
            totalHours,
            nodes: nodeEstimates,
            suggestedDailyHours,
            totalDays: Math.ceil(totalHours / suggestedDailyHours)
        };

    } catch (error) {
        console.error('Time estimation error:', error);
        return createDefaultEstimate(nodes);
    }
}

function createDefaultEstimate(
    nodes: Array<{ id: string; title: string; description?: string | null }>
): WorkflowSchedule {
    const nodeEstimates: NodeTimeEstimate[] = nodes.map(node => ({
        nodeId: node.id,
        nodeTitle: node.title,
        estimatedHours: 5,
        description: `Pelajari ${node.title}`
    }));

    return {
        totalHours: nodes.length * 5,
        nodes: nodeEstimates,
        suggestedDailyHours: 2,
        totalDays: Math.ceil((nodes.length * 5) / 2)
    };
}
