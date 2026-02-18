export interface TmPrediction {
  className: string;
  probability: number;
}

export interface TmImagePrediction {
  fileName: string;
  predictions: TmPrediction[];
}

type TeachableMachineOptions = {
  topK?: number;
  minProbability?: number;
};

const TM_BASE_URL_RAW = String(import.meta.env.VITE_TM_MODEL_URL || '').trim();
const TM_CDN_URL_RAW = String(
  import.meta.env.VITE_TM_CDN_URL || 'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8/dist/teachablemachine-image.min.js'
).trim();

type TmImageRuntime = {
  load: (modelUrl: string, metadataUrl: string) => Promise<{
    predict: (image: HTMLImageElement) => Promise<any[]>;
  }>;
};

type TmWindow = Window & {
  tmImage?: TmImageRuntime;
};

function safeBaseUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function isTeachableMachineConfigured(): boolean {
  return safeBaseUrl(TM_BASE_URL_RAW).length > 0;
}

export function resolveModelAndMetadataUrls(baseOrModelUrl: string): {
  modelUrl: string;
  metadataUrl: string;
} {
  const raw = String(baseOrModelUrl || '').trim();
  if (!raw) {
    return { modelUrl: '', metadataUrl: '' };
  }

  if (raw.endsWith('/model.json')) {
    const base = raw.slice(0, -'/model.json'.length);
    return {
      modelUrl: raw,
      metadataUrl: `${base}/metadata.json`,
    };
  }

  const base = safeBaseUrl(raw);
  return {
    modelUrl: `${base}/model.json`,
    metadataUrl: `${base}/metadata.json`,
  };
}

export function buildTeachableMachineLogLines(
  rows: TmImagePrediction[],
  options: { minProbability?: number; maxLines?: number } = {}
): string[] {
  const minProbability = Math.max(0, Math.min(1, Number(options.minProbability) || 0.55));
  const maxLines = Math.max(1, Math.min(40, Number(options.maxLines) || 12));
  const lines: string[] = [];

  for (const row of rows) {
    for (const pred of row.predictions) {
      if (pred.probability < minProbability) {
        continue;
      }
      lines.push(
        `[TM] image=${row.fileName} class=${pred.className} confidence=${(pred.probability * 100).toFixed(1)}%`
      );
      if (lines.length >= maxLines) {
        return lines;
      }
    }
  }
  return lines;
}

let modelPromise: Promise<any> | null = null;
let tmScriptPromise: Promise<TmImageRuntime> | null = null;

function fileToImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to decode image: ${file.name}`));
    };
    img.src = objectUrl;
  });
}

async function getModel() {
  if (modelPromise) {
    return modelPromise;
  }

  const { modelUrl, metadataUrl } = resolveModelAndMetadataUrls(TM_BASE_URL_RAW);
  if (!modelUrl || !metadataUrl) {
    throw new Error('VITE_TM_MODEL_URL is not configured.');
  }

  modelPromise = (async () => {
    const tmImage = await loadTmImageRuntime();
    return tmImage.load(modelUrl, metadataUrl);
  })();

  return modelPromise;
}

async function loadTmImageRuntime(): Promise<TmImageRuntime> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Teachable Machine runtime is only available in browser.');
  }

  const existing = (window as TmWindow).tmImage;
  if (existing) {
    return existing;
  }
  if (tmScriptPromise) {
    return tmScriptPromise;
  }

  tmScriptPromise = new Promise<TmImageRuntime>((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = TM_CDN_URL_RAW;
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      const runtime = (window as TmWindow).tmImage;
      if (!runtime?.load) {
        reject(new Error('Teachable Machine runtime loaded but `window.tmImage` was not found.'));
        return;
      }
      resolve(runtime);
    };
    script.onerror = () => {
      reject(new Error('Failed to load Teachable Machine runtime script.'));
    };

    document.head.appendChild(script);
  });

  return tmScriptPromise;
}

export async function predictWithTeachableMachine(
  files: File[],
  options: TeachableMachineOptions = {}
): Promise<TmImagePrediction[]> {
  if (!isTeachableMachineConfigured()) {
    return [];
  }
  if (!files.length) {
    return [];
  }

  const topK = Math.max(1, Math.min(10, Number(options.topK) || 3));
  const minProbability = Math.max(0, Math.min(1, Number(options.minProbability) || 0));
  const model = await getModel();

  const outputs: TmImagePrediction[] = [];
  for (const file of files) {
    const image = await fileToImageElement(file);
    const rawPredictions = await model.predict(image);
    const parsed: TmPrediction[] = Array.isArray(rawPredictions)
      ? rawPredictions
          .map((item: any) => ({
            className: String(item?.className || 'unknown'),
            probability: Number(item?.probability || 0),
          }))
          .filter((item: TmPrediction) => Number.isFinite(item.probability) && item.probability >= minProbability)
          .sort((a: TmPrediction, b: TmPrediction) => b.probability - a.probability)
          .slice(0, topK)
      : [];

    outputs.push({
      fileName: file.name,
      predictions: parsed,
    });
  }

  return outputs;
}
