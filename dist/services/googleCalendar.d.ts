export declare function getAuthUrl(): string;
export declare function getTokenFromCode(code: string): Promise<import("google-auth-library").Credentials>;
export interface CalendarEvent {
    title: string;
    description: string;
    startDate: Date;
    durationHours: number;
}
export declare function createCalendarEvents(accessToken: string, events: CalendarEvent[]): Promise<{
    success: boolean;
    eventIds: string[];
}>;
export declare function generateLearningSchedule(nodes: Array<{
    nodeId: string;
    nodeTitle: string;
    estimatedHours: number;
    description: string;
}>, startDate: Date, dailyHours?: number): CalendarEvent[];
