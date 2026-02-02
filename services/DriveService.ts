
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

export async function searchIncidentFiles(accessToken: string, options: { query?: string } = {}): Promise<{ files: DriveFile[] }> {
  try {
    const q = options.query ? `name contains '${options.query}'` : `name contains 'incident' or name contains 'log' or name contains 'grafana'`;
    // trashed=false 필터 추가
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)} and trashed=false&fields=files(id,name,mimeType,size)`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Drive API Search Error: ${res.status}`);
    }

    const data = await res.json();
    const allFiles = data.files || [];

    // [Defensive] 필터링 로직 안전하게 처리
    const validFiles = allFiles.filter((f: any) => 
      (f.mimeType?.startsWith('image/') || f.name?.endsWith('.log') || f.name?.endsWith('.txt'))
    );

    return { files: validFiles };
  } catch (error) {
    console.error("Drive Search Error:", error);
    return { files: [] };
  }
}

export async function downloadMultipleFiles(accessToken: string, files: DriveFile[]): Promise<DownloadedFile[]> {
  const results = await Promise.all(
    files.map(async (f) => {
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!res.ok) {
          console.warn(`Failed to download file ${f.name}: ${res.status}`);
          return null;
        }

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
