import { google } from 'googleapis';
import { getSupabase } from '../lib/supabase.js';

export interface CalendarEvent {
    title: string;
    description: string;
    startDate: Date;
    durationHours: number;
}

/**
 * Get Google access token from Supabase session
 * The user must be logged in via Supabase with Google provider
 */
export async function getGoogleAccessToken(supabaseAccessToken: string): Promise<string> {
    const supabase = getSupabase();

    // Get user session using the access token
    const { data: { user }, error } = await supabase.auth.getUser(supabaseAccessToken);

    if (error || !user) {
        throw new Error('Invalid Supabase session');
    }

    // Get Google provider token from user metadata
    const providerToken = user.app_metadata?.provider_token ||
                         user.user_metadata?.provider_token;

    if (!providerToken) {
        throw new Error('Google provider token not found. User must sign in with Google provider.');
    }

    return providerToken;
}

export async function createCalendarEvents(
    googleAccessToken: string,
    events: CalendarEvent[]
): Promise<{ success: boolean; eventIds: string[] }> {
    // Create OAuth2 client with just the access token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleAccessToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const eventIds: string[] = [];

    for (const event of events) {
        const endDate = new Date(event.startDate);
        endDate.setHours(endDate.getHours() + event.durationHours);

        const response = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
                summary: `📚 ${event.title}`,
                description: event.description,
                start: {
                    dateTime: event.startDate.toISOString(),
                    timeZone: 'Asia/Jakarta'
                },
                end: {
                    dateTime: endDate.toISOString(),
                    timeZone: 'Asia/Jakarta'
                },
                colorId: '9', // Blue color for learning
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: 30 }
                    ]
                }
            }
        });

        if (response.data.id) {
            eventIds.push(response.data.id);
        }
    }

    return { success: true, eventIds };
}

export function generateLearningSchedule(
    nodes: Array<{ nodeId: string; nodeTitle: string; estimatedHours: number; description: string }>,
    startDate: Date,
    dailyHours: number = 2
): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    let currentDate = new Date(startDate);

    for (const node of nodes) {
        const hoursRemaining = node.estimatedHours;
        let hoursScheduled = 0;

        while (hoursScheduled < hoursRemaining) {
            const sessionHours = Math.min(dailyHours, hoursRemaining - hoursScheduled);

            events.push({
                title: node.nodeTitle,
                description: node.description,
                startDate: new Date(currentDate),
                durationHours: sessionHours
            });

            hoursScheduled += sessionHours;

            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }

    return events;
}
