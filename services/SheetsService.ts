
import type { SavedIncident, DashboardStats, GoogleSheetInfo } from '../types';

export async function createIncidentDataset(accessToken: string, name: string): Promise<GoogleSheetInfo> {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: name },
      sheets: [{ properties: { title: 'Incidents' } }, { properties: { title: 'Stats' } }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create spreadsheet: ${res.statusText}`);
  }

  const data = await res.json();
  return { id: data.spreadsheetId, name: data.properties.title, url: data.spreadsheetUrl };
}

async function clearSheetRanges(accessToken: string, spreadsheetId: string, ranges: string[]): Promise<void> {
  // Clear multiple ranges to ensure no ghost data remains
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ranges }),
  });
}

export async function exportIncidentsToSheet(accessToken: string, spreadsheetId: string, incidents: SavedIncident[], stats: DashboardStats): Promise<void> {
  // 1. Clear existing data to avoid mixing old and new rows if the dataset shrunk
  try {
    await clearSheetRanges(accessToken, spreadsheetId, ['Incidents!A:Z', 'Stats!A:Z']);
  } catch (e) {
    console.warn("Failed to clear sheet ranges, proceeding with overwrite:", e);
  }

  // 2. Prepare Data
  const rows = [
    ['ID', 'Date', 'Severity', 'Title', 'Summary', 'Root Causes', 'Tags', 'Duration'],
    ...incidents.map((i) => [
      i.id || '',
      i.createdAt ? new Date(i.createdAt).toLocaleString() : '',
      i.report?.severity || 'UNKNOWN',
      i.report?.title || '',
      i.report?.summary || '',
      (i.report?.rootCauses || []).join('; '),
      (i.report?.tags || []).join(', '),
      i.report?.impact?.duration || 'N/A',
    ]),
  ];

  const statsRows = [
    ['Metric', 'Value'],
    ['Total Incidents', stats.totalIncidents || 0],
    ['SEV1', stats.severityDistribution?.SEV1 || 0],
    ['SEV2', stats.severityDistribution?.SEV2 || 0],
    ['SEV3', stats.severityDistribution?.SEV3 || 0],
  ];

  // 3. Write Data
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: 'Incidents!A1', values: rows },
        { range: 'Stats!A1', values: statsRows },
      ],
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error("Sheets Export Error Details:", errorData);
    throw new Error(`Failed to export data to sheet: ${res.status}`);
  }
}

export async function findExistingDatasets(accessToken: string): Promise<GoogleSheetInfo[]> {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=name contains 'AegisOps' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false&fields=files(id,name,webViewLink)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) return [];

    const data = await res.json();
    return (data.files || []).map((f: any) => ({ id: f.id, name: f.name, url: f.webViewLink }));
  } catch (e) {
    console.warn("Failed to find existing datasets", e);
    return [];
  }
}

export const SheetsService = { createIncidentDataset, exportIncidentsToSheet, findExistingDatasets };
export default SheetsService;
