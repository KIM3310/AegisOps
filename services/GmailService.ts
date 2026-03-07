
import { googleApiJson } from './googleApiClient';

export interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
}

export async function searchAlertEmails(accessToken: string, options: { maxResults?: number; customQuery?: string } = {}): Promise<{ messages: GmailMessage[] }> {
  try {
    const query = options.customQuery || 'from:alerts@datadog.com OR from:noreply@pagerduty.com OR subject:incident OR subject:alert';
    const maxResults = Math.max(1, Math.min(50, Number(options.maxResults || 10)));
    const data = await googleApiJson<any>({
      accessToken,
      label: 'Gmail search messages',
      url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    });
    const messageList = data.messages || [];

    const messages = await Promise.all(
      messageList.slice(0, 10).map(async (m: any) => {
        try {
          const msg = await googleApiJson<any>({
            accessToken,
            label: `Gmail read message (${m.id})`,
            url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
          });
          const headers = msg.payload?.headers || [];
          const get = (n: string) => headers.find((h: any) => h.name?.toLowerCase() === n.toLowerCase())?.value || '';

          return {
            id: msg.id,
            subject: get('Subject') || '(No Subject)',
            from: get('From') || 'Unknown',
            date: get('Date'),
            snippet: msg.snippet || '',
            body: msg.snippet || '',
          };
        } catch (innerError) {
          console.warn(`Failed to fetch email details for ${m.id}`, innerError);
          return null;
        }
      })
    );
    return { messages: messages.filter((m): m is GmailMessage => m !== null) };

  } catch (error) {
    console.error("Gmail Search Error:", error);
    return { messages: [] };
  }
}

export async function batchExtractLogs(emails: GmailMessage[]): Promise<string> {
  if (!Array.isArray(emails) || emails.length === 0) return '';
  return emails.map((e) => `=== ${e.subject} (${e.date}) ===\n${e.body}`).join('\n\n');
}

export const GmailService = { searchAlertEmails, batchExtractLogs };
export default GmailService;
