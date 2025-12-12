
import { GoogleGenAI, Modality } from '@google/genai';
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

/**
 * [Utility] Ultimate JSON Extractor (Iterative & Robust)
 * LLM 응답에서 순수 JSON 문자열만 추출합니다.
 */
function extractJSON(text: string): string {
  // Remove markdown fences (case insensitive for 'json')
  let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  // Try to find valid JSON by iterating through potential start positions
  let startIdx = cleanText.indexOf('{');
  
  while (startIdx !== -1) {
    let braceCount = 0;
    let inString = false;
    let escape = false;
    
    for (let i = startIdx; i < cleanText.length; i++) {
      const char = cleanText[i];
      if (escape) { escape = false; continue; }
      if (char === '\\') { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }

      if (!inString) {
        if (char === '{') braceCount++;
        else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            // Found a balanced block
            const candidate = cleanText.substring(startIdx, i + 1);
            try {
              JSON.parse(candidate); // Validate parsing
              return candidate;
            } catch (e) {
              // Not valid JSON, try finding next block
              break; 
            }
          }
        }
      }
    }
    startIdx = cleanText.indexOf('{', startIdx + 1);
  }

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
        },
      });

      const text = response.text?.trim();
      if (!text) throw new Error("Empty response from AI");

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
      if (error.message?.includes('SAFETY')) {
         throw new Error("Analysis blocked by Safety Filters. Please redact sensitive PII from logs.");
      }

      if (attempt === strategies.length - 1) {
        throw new Error("Analysis failed after multiple attempts. Please check inputs.");
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
      config: { tools: [{ googleSearch: {} }] }
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
