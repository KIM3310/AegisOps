
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
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${options.maxResults || 10}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // [Defensive] HTTP 에러 체크
    if (!res.ok) {
      throw new Error(`Gmail API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    
    // [Defensive] messages 필드가 없거나 null일 수 있음
    const messageList = data.messages || [];

    const messages = await Promise.all(
      messageList.slice(0, 10).map(async (m: any) => {
        try {
          const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          
          if (!msgRes.ok) return null; // 개별 메시지 로드 실패 시 무시

          const msg = await msgRes.json();
          const headers = msg.payload?.headers || [];
          const get = (n: string) => headers.find((h: any) => h.name?.toLowerCase() === n.toLowerCase())?.value || '';

          return {
            id: msg.id,
            subject: get('Subject') || '(No Subject)',
            from: get('From') || 'Unknown',
            date: get('Date'),
            snippet: msg.snippet || '',
            body: msg.snippet || '', // 실제 바디 디코딩은 복잡하므로 스니펫 사용 (간소화)
          };
        } catch (innerError) {
          console.warn(`Failed to fetch email details for ${m.id}`, innerError);
          return null;
        }
      })
    );

    // null 필터링 (실패한 요청 제외)
    return { messages: messages.filter((m): m is GmailMessage => m !== null) };

  } catch (error) {
    console.error("Gmail Search Error:", error);
    // UI가 깨지지 않도록 빈 배열 반환
    return { messages: [] };
  }
}

export async function batchExtractLogs(emails: GmailMessage[]): Promise<string> {
  if (!Array.isArray(emails) || emails.length === 0) return '';
  return emails.map((e) => `=== ${e.subject} (${e.date}) ===\n${e.body}`).join('\n\n');
}

export const GmailService = { searchAlertEmails, batchExtractLogs };
export default GmailService;
