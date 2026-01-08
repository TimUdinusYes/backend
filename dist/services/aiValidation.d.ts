export interface ValidationResult {
    isValid: boolean;
    reason: string;
    recommendation?: string;
}
export declare function validateLearningPath(fromNode: string, toNode: string): Promise<ValidationResult>;
export interface DuplicateCheckResult {
    isDuplicate: boolean;
    reason: string;
    similarNode?: {
        id: string;
        title: string;
    };
}
export declare function checkDuplicateNode(newTitle: string, existingNodes: Array<{
    id: string;
    title: string;
    description?: string | null;
}>): Promise<DuplicateCheckResult>;
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
export declare function estimateWorkflowTime(nodes: Array<{
    id: string;
    title: string;
    description?: string | null;
}>): Promise<WorkflowSchedule>;
export interface ExtractedNode {
    title: string;
    description: string;
    icon: string;
    color: string;
    order: number;
}
export interface TopicConversionResult {
    nodes: ExtractedNode[];
    edges: Array<{
        from: number;
        to: number;
    }>;
    summary: string;
}
export declare function extractNodesFromTopic(topicTitle: string, topicDescription: string | null): Promise<TopicConversionResult>;
