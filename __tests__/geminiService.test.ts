import { analyzeIncident } from '../services/geminiService';
import { GoogleGenAI } from '@google/genai';

// Mock types for Jest
declare var jest: any;
declare var describe: any;
declare var it: any;
declare var expect: any;
declare var beforeAll: any;
declare var afterAll: any;
declare var beforeEach: any;
declare namespace jest {
  type Mock = any;
}

// GoogleGenAI 모듈 모킹
jest.mock('@google/genai');

const mockGenerateContent = jest.fn();

// GoogleGenAI 클래스 생성자 모킹
(GoogleGenAI as jest.Mock).mockImplementation(() => {
  return {
    models: {
      generateContent: mockGenerateContent,
    },
  };
});

describe('GeminiService', () => {
  const mockApiKey = 'TEST_API_KEY';
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = { ...originalEnv, API_KEY: mockApiKey };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully analyze logs and return parsed JSON report', async () => {
    // 1. Mock Response 설정
    const mockReport = {
      title: "Test Incident",
      severity: "SEV1",
      summary: "Test Summary",
      rootCauses: ["Cause 1"],
      timeline: [],
      actionItems: [],
      tags: ["test"]
    };

    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: {} }], // 구조상 존재 체크용
      text: JSON.stringify(mockReport)
    });

    // 2. 함수 실행
    const result = await analyzeIncident("Error log line 1", []);

    // 3. 검증
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockReport);
    expect(result.severity).toBe("SEV1");
  });

  it('should handle markdown code blocks in AI response', async () => {
    // AI가 가끔 ```json ... ``` 형태로 응답하는 경우 처리 검증
    const mockReport = { title: "Markdown Test", severity: "SEV2" };
    const markdownResponse = `Here is the analysis:\n\`\`\`json\n${JSON.stringify(mockReport)}\n\`\`\``;

    mockGenerateContent.mockResolvedValue({
      candidates: [{}],
      text: markdownResponse
    });

    const result = await analyzeIncident("logs...");
    expect(result).toEqual(mockReport);
  });

  it('should throw an error if API key is missing', async () => {
    process.env.API_KEY = ''; // 키 제거
    // 모듈이 로드될 때 이미 인스턴스가 생성되므로, 함수 내부의 체크 로직을 테스트하기 위해
    // 실제 구현부의 방어적 코드(if (!apiKey))가 동작하는지 확인
    
    // Note: 실제 서비스 파일에서는 모듈 레벨에서 초기화되므로 
    // 완벽한 테스트를 위해선 analyzeIncident 내부의 throw 로직을 확인
    await expect(analyzeIncident("logs")).rejects.toThrow("API Key is missing");
    
    process.env.API_KEY = mockApiKey; // 복구
  });

  it('should throw specific error when AI returns invalid JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [{}],
      text: "I cannot analyze this log." // 유효하지 않은 JSON
    });

    await expect(analyzeIncident("logs")).rejects.toThrow("Failed to parse the AI response");
  });

  it('should handle API network errors gracefully', async () => {
    mockGenerateContent.mockRejectedValue(new Error("Network Error"));
    
    await expect(analyzeIncident("logs")).rejects.toThrow("AI Analysis Failed: Network Error");
  });
});