import { google } from 'googleapis';
import { getSupabase } from '../lib/supabase.js';

export interface CalendarEvent {
    title: string;
    description: string;
    startDate: Date;
    durationHours: number;
}

/**
 * Securely retrieve Google access token from Supabase session
 * IMPORTANT: This should ONLY be called from the backend
 * 
 * @param supabaseAccessToken - Supabase session access token from Authorization header
 * @returns Google OAuth access token for Calendar API
 */
export async function getGoogleAccessToken(supabaseAccessToken: string): Promise<string> {
    const supabase = getSupabase();

    // Validate Supabase session and get user
    const { data: { user }, error } = await supabase.auth.getUser(supabaseAccessToken);

    if (error || !user) {
        console.error('Supabase auth error:', error?.message);
        throw new Error('Invalid or expired session. Please sign in again.');
    }

    // Verify user signed in with Google
    const provider = user.app_metadata?.provider;
    if (provider !== 'google') {
        throw new Error('User must sign in with Google to use Google Calendar integration');
    }

    // Check user.identities for Google provider token (Supabase v2.39.0+)
    if (user.identities && user.identities.length > 0) {
        for (const identity of user.identities) {
            if ((identity as any).provider === 'google') {
                // Try different property names where Supabase might store the token
                const token = (identity as any).provider_token ||
                             (identity as any).access_token ||
                             (identity as any).identity_data?.provider_token;

                if (token) {
                    console.log('✓ Google access token retrieved from Supabase');
                    return token;
                }
            }
        }
    }

    // Check app_metadata (older Supabase versions)
    if (user.app_metadata?.provider_token) {
        console.log('✓ Google access token retrieved from app_metadata');
        return user.app_metadata.provider_token;
    }

    // Check user_metadata (fallback)
    if (user.user_metadata?.provider_token) {
        console.log('✓ Google access token retrieved from user_metadata');
        return user.user_metadata.provider_token;
    }

    // Token not found - provide helpful error message
    console.error('❌ Google provider token not found in Supabase session');
    throw new Error(
        'Google Calendar access not available. This can happen if:\n' +
        '1. Calendar scope was not granted during sign-in\n' +
        '2. Your session has expired\n' +
        '3. Supabase is not configured to save provider tokens\n\n' +
        'Please sign out and sign in again with Google, making sure to grant Calendar access.'
    );
}

/**
 * Create events in user's Google Calendar
 * SECURITY: Only accepts access token from getGoogleAccessToken()
 */
export async function createCalendarEvents(
    googleAccessToken: string,
    events: CalendarEvent[]
): Promise<{ success: boolean; eventIds: string[] }> {
    console.log(`Creating ${events.length} calendar events...`);

    // Create OAuth2 client with the access token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleAccessToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const eventIds: string[] = [];

    for (const event of events) {
        const endDate = new Date(event.startDate);
        endDate.setHours(endDate.getHours() + event.durationHours);

        try {
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
                console.log(`✓ Event created: ${event.title}`);
            }
        } catch (error: any) {
            console.error(`Failed to create event "${event.title}":`, error.message);
            
            // Provide user-friendly error messages
            if (error.message.includes('insufficient authentication')) {
                throw new Error('Calendar access denied. Please sign in again and grant Calendar permissions.');
            } else if (error.message.includes('invalid_grant')) {
                throw new Error('Your Google session has expired. Please sign in again.');
            } else {
                throw new Error(`Failed to create calendar event: ${error.message}`);
            }
        }
    }

    console.log(`✓ Successfully created ${eventIds.length} events`);
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
