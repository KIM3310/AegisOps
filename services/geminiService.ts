
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from '@google/genai';
import type { IncidentReport, ReferenceSource } from '../types';

/**
 * ==============================================================================
 * GEMINI SERVICE: FINAL PRODUCTION BUILD
 * ==============================================================================
 * 이 서비스는 애플리케이션의 '두뇌' 역할을 합니다.
 * Gemini 3 Pro 모델을 호출하고, 비정형 텍스트/이미지 데이터를 구조화된 JSON으로 변환합니다.
 */

const apiKey = process.env.API_KEY || '';
if (!apiKey) {
  console.warn('Gemini API Key is missing. AI features will not work.');
}

// Gemini 클라이언트 인스턴스 초기화
const ai = new GoogleGenAI({ apiKey });

/**
 * [Prompt Engineering Strategy]
 * 단순한 "분석해줘"가 아닌, 구체적인 페르소나(Principal SRE)와 사고 과정(Chain of Thought)을 주입합니다.
 */
const SYSTEM_INSTRUCTION = `You are a Principal SRE at Google, utilizing Gemini 3 Pro's advanced reasoning capabilities.
Your task is to analyze incident logs and monitoring screenshots to generate a "Gold Standard" Post-Mortem Report.

### REASONING PROCESS (Chain of Thought)
Before generating the JSON, perform a deep logical deduction:
1.  **Correlate**: Link timestamps in logs with visual anomalies in screenshots.
2.  **Deduce**: Differentiate between the *symptom* (e.g., high latency) and the *root cause* (e.g., thread pool exhaustion due to config change).
3.  **Integrity Check**: If the logs do not contain enough information to determine the root cause, explicitly state "Investigation Needed" instead of guessing.

### OUTPUT FORMAT RULES
1. Output **ONLY** raw valid JSON.
2. **NO** markdown formatting (e.g., no \`\`\`json ... \`\`\`).
3. **NO** preamble or postscript (e.g., "Here is the analysis...").
4. Start the response immediately with '{'.

### JSON SCHEMA
{
  "title": "Concise, Impactful Title (e.g., 'Redis Cluster Partition causing API Latency')",
  "summary": "Executive summary for CTO/VP level.",
  "severity": "SEV1|SEV2|SEV3|UNKNOWN",
  "rootCauses": ["Technical Trigger", "Systemic Failure"],
  "reasoning": "A detailed, step-by-step technical deduction showing how you reached the conclusion. You may use [Link Title](URL) markdown syntax for references.",
  "confidenceScore": 95,
  "timeline": [
    {"time": "HH:mm:ss", "description": "Event description", "severity": "critical|warning|info|success"}
  ],
  "actionItems": [
    {"task": "Actionable task", "owner": "Role", "priority": "HIGH|MEDIUM|LOW"}
  ],
  "mitigationSteps": ["Immediate fix applied"],
  "impact": {
    "estimatedUsersAffected": "Estimate", 
    "duration": "Calculated duration", 
    "peakLatency": "Extract max", 
    "peakErrorRate": "Extract max %"
  },
  "tags": ["service", "error-type", "infrastructure"],
  "lessonsLearned": "Successes vs Failures",
  "preventionRecommendations": ["Architecture", "Process"]
}`;

// [Critical] Logs often contain words like 'kill', 'die', 'attack', 'abort'.
// We must disable safety blocks to ensure technical logs are processed correctly.
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

/**
 * [Utility] Ultimate JSON Extractor (Iterative & Robust)
 * LLM 응답에서 순수 JSON 문자열만 추출합니다.
 */
function extractJSON(text: string): string {
  if (!text) return "{}";

  // 1. Remove Markdown Fences (```json ... ```)
  // 정규식으로 ```json, ``` 등을 제거하고 앞뒤 공백 제거
  let cleanText = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

  // 2. Find first '{' and last '}'
  const startIdx = cleanText.indexOf('{');
  const endIdx = cleanText.lastIndexOf('}');

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    // JSON 구조가 아예 없으면 원본 반환 (파싱 에러 유도)
    return cleanText;
  }

  // 3. Extract purely the JSON block
  cleanText = cleanText.substring(startIdx, endIdx + 1);

  return cleanText;
}

function repairJSON(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    let fixed = jsonStr;
    // 1. Remove Trailing Commas
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // 2. Fix Unquoted Keys (e.g. { key: "value" } -> { "key": "value" })
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');

    // 3. Remove Control Characters (preserve newlines/tabs)
    fixed = fixed.replace(/[\x00-\x1F\x7F]/g, (match) => {
        if (match === '\n' || match === '\r' || match === '\t') return match; 
        return ''; 
    });

    try {
      return JSON.parse(fixed);
    } catch (e2) {
      console.warn("JSON Repair Failed:", e2);
      throw new Error("Failed to parse AI response. Please try again.");
    }
  }
}

export async function analyzeIncident(logs: string, images: string[] = []): Promise<IncidentReport> {
  if (!apiKey) throw new Error("API Key is missing.");

  const parts: any[] = [{
    text: `=== LOGS ===\n${logs || 'No text logs provided.'}\n\n${images.length > 0 ? `[Analyze ${images.length} attached monitoring screenshots]` : ''}`
  }];

  images.forEach((img) => {
    if (img) parts.push({ inlineData: { mimeType: 'image/png', data: img } });
  });

  const strategies = [
    { temp: 0.2, topK: 30 }, 
    { temp: 0.4, topK: 40 }, 
  ];

  for (let attempt = 0; attempt < strategies.length; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: strategies[attempt].temp,
          topK: strategies[attempt].topK,
          tools: [{ googleSearch: {} }],
          safetySettings: SAFETY_SETTINGS, // Apply safety overrides
        },
      });

      const text = response.text?.trim();
      if (!text) {
        // [Safety Check] Safety Filter에 걸렸을 경우 text가 비어있을 수 있음
        if (response.candidates?.[0]?.finishReason) {
            console.warn("Finish Reason:", response.candidates[0].finishReason);
            if (response.candidates[0].finishReason !== 'STOP') {
                throw new Error(`Analysis stopped: ${response.candidates[0].finishReason}`);
            }
        }
        throw new Error("Empty response from AI");
      }

      const jsonStr = extractJSON(text);
      const raw = repairJSON(jsonStr);

      // Default values to ensure UI doesn't crash
      const report: IncidentReport = {
        title: raw.title || "Untitled Incident",
        summary: raw.summary || "No summary available.",
        severity: ["SEV1", "SEV2", "SEV3"].includes(raw.severity) ? raw.severity : "UNKNOWN",
        rootCauses: Array.isArray(raw.rootCauses) ? raw.rootCauses : [],
        reasoning: raw.reasoning || "AI explanation missing.",
        confidenceScore: typeof raw.confidenceScore === 'number' ? raw.confidenceScore : 50,
        timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
        actionItems: Array.isArray(raw.actionItems) ? raw.actionItems : [],
        mitigationSteps: Array.isArray(raw.mitigationSteps) ? raw.mitigationSteps : [],
        impact: raw.impact || {},
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        lessonsLearned: raw.lessonsLearned || "",
        preventionRecommendations: Array.isArray(raw.preventionRecommendations) ? raw.preventionRecommendations : [],
      };

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const references: ReferenceSource[] = chunks
        .map((c: any) => (c.web ? { title: c.web.title, uri: c.web.uri } : null))
        .filter((r: any) => r !== null);
      
      if (references.length > 0) report.references = references;

      return report;

    } catch (error: any) {
      console.warn(`Analysis Attempt ${attempt + 1} failed:`, error);
      
      // If it's a safety block error, fail immediately (retrying same prompt won't help)
      if (error.message?.includes('SAFETY') || error.message?.includes('BLOCKED')) {
         throw new Error("Analysis blocked by Safety Filters. Please redact sensitive PII from logs.");
      }

      if (attempt === strategies.length - 1) {
        throw new Error(error.message || "Analysis failed after multiple attempts.");
      }
    }
  }
  throw new Error("Unexpected execution path");
}

export async function generateFollowUp(
  report: IncidentReport, 
  history: { role: 'user' | 'model'; parts: { text: string }[] }[], 
  question: string
): Promise<string> {
  try {
    const contextStr = `[System Context]\nIncident: ${report.title} (${report.severity})\nSummary: ${report.summary}\nRoot Cause: ${report.rootCauses.join(', ')}\nReasoning: ${report.reasoning}\n\nYou are a helpful SRE assistant answering questions about this specific incident.`;

    const chatHistory = [
      { role: 'user', parts: [{ text: contextStr }] },
      { role: 'model', parts: [{ text: "Understood. I have the incident context. Ask me anything." }] },
      ...history
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [...chatHistory, { role: 'user', parts: [{ text: question }] }],
      config: { 
        tools: [{ googleSearch: {} }],
        safetySettings: SAFETY_SETTINGS 
      }
    });
    return response.text || "No answer generated.";
  } catch (e) {
    console.error("Follow-up chat error:", e);
    return "The assistant is temporarily unavailable.";
  }
}

export async function generateTTS(text: string): Promise<string | undefined> {
  try {
    if (!text || text.trim().length === 0) return undefined;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: `You are a professional SRE. Provide a concise audio briefing. 
      Instructions: Speak naturally, ignore markdown symbols, and focus on the core issue.
      Summary: "${text}"` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
        safetySettings: SAFETY_SETTINGS
      },
    });
    
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (e) {
    console.error("TTS Generation Error:", e);
    throw new Error("Failed to generate speech.");
  }
}

export const GeminiService = { analyzeIncident, generateFollowUp, generateTTS };
export default GeminiService;
