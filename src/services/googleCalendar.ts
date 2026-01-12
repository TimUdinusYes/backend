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
        console.error('Supabase auth error:', error);
        throw new Error('Invalid Supabase session');
    }

    console.log('=== DEBUG: User Auth Info ===');
    console.log('User ID:', user.id);
    console.log('User provider:', user.app_metadata?.provider);
    console.log('User email:', user.email);
    console.log('Full user object keys:', Object.keys(user));

    // IMPORTANT: Supabase v2.39.0+ stores provider tokens in user.identities
    // Let's check all possible locations

    // Method 1: Check user.identities (most common location)
    if (user.identities && user.identities.length > 0) {
        console.log(`Found ${user.identities.length} identities`);

        for (const identity of user.identities) {
            console.log(`Identity provider: ${(identity as any).provider}`);

            if ((identity as any).provider === 'google') {
                console.log('Google identity found!');
                console.log('Identity keys:', Object.keys(identity));

                // Try different property names
                const token = (identity as any).provider_token ||
                             (identity as any).access_token ||
                             (identity as any).identity_data?.provider_token;

                if (token) {
                    console.log('✓ Google access token found in identities:', token.substring(0, 20) + '...');
                    return token;
                }

                console.log('Full identity object:', JSON.stringify(identity, null, 2));
            }
        }
    }

    // Method 2: Check app_metadata
    if (user.app_metadata?.provider_token) {
        console.log('✓ Token found in app_metadata');
        return user.app_metadata.provider_token;
    }

    // Method 3: Check user_metadata
    if (user.user_metadata?.provider_token) {
        console.log('✓ Token found in user_metadata');
        return user.user_metadata.provider_token;
    }

    // If we get here, token was not found
    console.error('❌ Provider token not found anywhere');
    console.error('Full user object:', JSON.stringify(user, null, 2));

    throw new Error('Google provider token not found. This usually happens because:\n' +
        '1. User did not sign in with Google\n' +
        '2. Calendar scope was not granted\n' +
        '3. Supabase is not configured to save provider tokens\n\n' +
        'Please sign in again with Google and grant Calendar access.');
}

export async function createCalendarEvents(
    googleAccessToken: string,
    events: CalendarEvent[]
): Promise<{ success: boolean; eventIds: string[] }> {
    console.log(`Creating ${events.length} calendar events...`);

    // Create OAuth2 client with just the access token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleAccessToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const eventIds: string[] = [];

    for (const event of events) {
        const endDate = new Date(event.startDate);
        endDate.setHours(endDate.getHours() + event.durationHours);

        console.log(`Creating event: ${event.title} at ${event.startDate.toISOString()}`);

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
                console.log(`✓ Event created: ${response.data.id}`);
            }
        } catch (error: any) {
            console.error(`Failed to create event "${event.title}":`, error.message);
            throw new Error(`Failed to create calendar event: ${error.message}`);
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
