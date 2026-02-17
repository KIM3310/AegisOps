import { describe, expect, it } from 'vitest';
import {
  buildTeachableMachineLogLines,
  resolveModelAndMetadataUrls,
  type TmImagePrediction,
} from '../services/teachableMachineService';

describe('teachableMachineService helpers', () => {
  it('resolves model+metadata URLs from base path', () => {
    const urls = resolveModelAndMetadataUrls('https://teachable.example/model-base/');
    expect(urls.modelUrl).toBe('https://teachable.example/model-base/model.json');
    expect(urls.metadataUrl).toBe('https://teachable.example/model-base/metadata.json');
  });

  it('resolves metadata when input already points to model.json', () => {
    const urls = resolveModelAndMetadataUrls('https://teachable.example/model-base/model.json');
    expect(urls.modelUrl).toBe('https://teachable.example/model-base/model.json');
    expect(urls.metadataUrl).toBe('https://teachable.example/model-base/metadata.json');
  });

  it('builds bounded high-confidence log lines', () => {
    const rows: TmImagePrediction[] = [
      {
        fileName: 'cam-1.png',
        predictions: [
          { className: 'fall', probability: 0.92 },
          { className: 'walk', probability: 0.2 },
        ],
      },
      {
        fileName: 'cam-2.png',
        predictions: [{ className: 'crowd', probability: 0.78 }],
      },
    ];

    const lines = buildTeachableMachineLogLines(rows, { minProbability: 0.55, maxLines: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('class=fall');
    expect(lines[0]).toContain('confidence=92.0%');
  });
});
