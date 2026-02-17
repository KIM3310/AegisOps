import type { IncidentReport } from '../types';

const CHAT_WEBHOOK_TIMEOUT_MS = 10_000;

function isValidWebhookUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function sendToChatWebhook(webhookUrl: string, report: IncidentReport): Promise<boolean> {
  const emoji: Record<string, string> = { SEV1: '🔴', SEV2: '🟠', SEV3: '🟡', UNKNOWN: '⚪' };
  if (!isValidWebhookUrl(webhookUrl)) {
    return false;
  }
  const severity = report.severity in emoji ? report.severity : 'UNKNOWN';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHAT_WEBHOOK_TIMEOUT_MS);

  const message = {
    cards: [
      {
        header: {
          title: `${emoji[severity]} [${severity}] ${report.title}`,
          subtitle: 'AegisOps Incident Report',
        },
        sections: [
          { header: 'Summary', widgets: [{ textParagraph: { text: report.summary } }] },
          {
            header: 'Impact',
            widgets: [
              {
                textParagraph: {
                  text: `👥 Users: ${report.impact?.estimatedUsersAffected || 'N/A'}\n⏱️ Duration: ${report.impact?.duration || 'N/A'}`,
                },
              },
            ],
          },
          {
            header: 'Root Causes',
            widgets: [{ textParagraph: { text: report.rootCauses.map((c, i) => `${i + 1}. ${c}`).join('\n') } }],
          },
          {
            header: 'Action Items',
            widgets: [
              {
                textParagraph: {
                  text: report.actionItems.slice(0, 3).map((a) => `• [${a.priority}] ${a.task}`).join('\n'),
                },
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

export const ChatService = { sendToChatWebhook };
export default ChatService;
