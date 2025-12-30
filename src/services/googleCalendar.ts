import { google } from 'googleapis';

function getRedirectUri(): string {
    return process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/api/auth/google/callback';
}

function getOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = getRedirectUri();

    if (!clientId || !clientSecret) {
        throw new Error('Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(): string {
    const redirectUri = getRedirectUri();

    console.log('OAuth Config:', {
        clientId: process.env.GOOGLE_CLIENT_ID ? 'Set (' + process.env.GOOGLE_CLIENT_ID?.substring(0, 10) + '...)' : 'NOT SET',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'NOT SET',
        redirectUri
    });

    const oauth2Client = getOAuth2Client();

    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar.events'],
        prompt: 'consent',
        redirect_uri: redirectUri
    });
}

export async function getTokenFromCode(code: string) {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken({
        code,
        redirect_uri: getRedirectUri()
    });
    return tokens;
}

export interface CalendarEvent {
    title: string;
    description: string;
    startDate: Date;
    durationHours: number;
}

export async function createCalendarEvents(
    accessToken: string,
    events: CalendarEvent[]
): Promise<{ success: boolean; eventIds: string[] }> {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });
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
