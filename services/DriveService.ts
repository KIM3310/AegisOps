
import { googleApiFetch, googleApiJson } from './googleApiClient';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface DownloadedFile {
  name: string;
  mimeType: string;
  data: string; // Text content or Base64 string
  type: 'log' | 'image';
}

function escapeDriveQueryLiteral(value: string): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function searchIncidentFiles(accessToken: string, options: { query?: string } = {}): Promise<{ files: DriveFile[] }> {
  try {
    const q = options.query
      ? `name contains '${escapeDriveQueryLiteral(options.query)}'`
      : `name contains 'incident' or name contains 'log' or name contains 'grafana'`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)} and trashed=false&fields=files(id,name,mimeType,size)`;

    const data = await googleApiJson<any>({
      accessToken,
      label: 'Google Drive search incident files',
      url,
    });
    const allFiles = data.files || [];

    const validFiles = allFiles.filter((f: any) => 
      (f.mimeType?.startsWith('image/') || f.name?.endsWith('.log') || f.name?.endsWith('.txt'))
    );

    return {
      files: validFiles.map((f: any) => ({
        id: String(f.id || '').trim(),
        name: String(f.name || '').trim(),
        mimeType: String(f.mimeType || '').trim(),
        size: Number(f.size || 0),
      })),
    };
  } catch (error) {
    console.error("Drive Search Error:", error);
    return { files: [] };
  }
}

export async function downloadMultipleFiles(accessToken: string, files: DriveFile[]): Promise<DownloadedFile[]> {
  const results = await Promise.all(
    files.map(async (f) => {
      try {
        const res = await googleApiFetch({
          accessToken,
          label: `Google Drive download file (${f.name})`,
          url: `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`,
        });

        if (f.mimeType?.startsWith('image/')) {
          const blob = await res.blob();
          const b64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = () => reject(new Error('FileReader error'));
            reader.readAsDataURL(blob);
          });
          return { name: f.name, mimeType: f.mimeType, data: b64, type: 'image' as const };
        } else {
          const text = await res.text();
          return { name: f.name, mimeType: f.mimeType || 'text/plain', data: text, type: 'log' as const };
        }
      } catch (fileError) {
        console.error(`Error processing file ${f.name}:`, fileError);
        return null;
      }
    })
  );

  return results.filter((r): r is DownloadedFile => r !== null);
}

export const DriveService = { searchIncidentFiles, downloadMultipleFiles };
export default DriveService;
