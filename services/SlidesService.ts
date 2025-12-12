import type { IncidentReport, GoogleSlideInfo } from '../types';

export async function createIncidentSlides(accessToken: string, report: IncidentReport): Promise<GoogleSlideInfo> {
  const createRes = await fetch('https://slides.googleapis.com/v1/presentations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `[${report.severity}] ${report.title} - Incident Report` }),
  });

  const presentation = await createRes.json();
  const presentationId = presentation.presentationId;
  const pageId = presentation.slides?.[0]?.objectId || 'p';

  const requests: any[] = [
    {
      insertText: {
        objectId: `${pageId}_title`,
        text: `[${report.severity}] ${report.title}`,
        insertionIndex: 0,
      },
    },
  ];

  const slideData = [
    { title: 'Summary', body: `${report.summary}\n\nUsers: ${report.impact?.estimatedUsersAffected || 'N/A'}\nDuration: ${report.impact?.duration || 'N/A'}` },
    { title: 'Timeline', body: report.timeline.slice(0, 6).map((t) => `• ${t.time}: ${t.description}`).join('\n') },
    { title: 'Root Causes', body: report.rootCauses.map((c, i) => `${i + 1}. ${c}`).join('\n') },
    { title: 'Action Items', body: report.actionItems.map((a, i) => `${i + 1}. [${a.priority}] ${a.task}`).join('\n') },
  ];

  slideData.forEach((slide, index) => {
    requests.push({
      createSlide: {
        objectId: `slide_${index + 1}`,
        insertionIndex: index + 1,
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
      },
    });
  });

  try {
    await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
  } catch (e) {
    console.error('Slides update error:', e);
  }

  return {
    id: presentationId,
    name: presentation.title,
    url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
  };
}

export const SlidesService = { createIncidentSlides };
export default SlidesService;