import type { IncidentReport } from '../types';

export async function sendToChatWebhook(webhookUrl: string, report: IncidentReport): Promise<boolean> {
  const emoji: Record<string, string> = { SEV1: '🔴', SEV2: '🟠', SEV3: '🟡', UNKNOWN: '⚪' };

  const message = {
    cards: [
      {
        header: {
          title: `${emoji[report.severity]} [${report.severity}] ${report.title}`,
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
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const ChatService = { sendToChatWebhook };
export default ChatService;