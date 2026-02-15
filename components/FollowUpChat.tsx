
import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { generateFollowUp } from '../services/geminiService';
import type { IncidentReport } from '../types';

interface Props {
  report: IncidentReport;
  enableGrounding?: boolean;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const suggestions = ['How can we prevent recurrence?', 'Suggest monitoring improvements', 'Draft a customer apology', 'Estimate financial impact'];

export const FollowUpChat: React.FC<Props> = ({ report, enableGrounding = false }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async (q: string) => {
    if (!q.trim() || loading) return;
    
    // UI 업데이트를 위해 먼저 메시지 추가
    const newMsg: Msg = { role: 'user', content: q };
    const currentHistory = [...msgs]; // 현재까지의 히스토리 캡처
    
    setMsgs((p) => [...p, newMsg]);
    setInput('');
    setLoading(true);

    try {
      const r = await generateFollowUp(report, currentHistory, q, { enableGrounding });
      setMsgs((p) => [...p, { role: 'assistant', content: r }]);
    } catch {
      setMsgs((p) => [...p, { role: 'assistant', content: 'Error generating response.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {msgs.length === 0 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested questions">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="text-2xs text-text-muted hover:text-text px-2 py-1 bg-bg hover:bg-bg-hover border border-border rounded"
            >
              {s}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2 mb-3 max-h-48 overflow-y-auto" role="log" aria-live="polite" aria-label="Chat history">
          {msgs.map((m, i) => (
            <div key={i} className={`text-xs p-2 rounded ${m.role === 'user' ? 'bg-accent/10 ml-8' : 'bg-bg mr-8 text-text-muted'}`}>
              <span className="sr-only">{m.role === 'user' ? 'You: ' : 'AI: '}</span>
              {m.content}
            </div>
          ))}
          {loading && <div className="text-2xs text-text-dim flex items-center gap-1" role="status"><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />Thinking...</div>}
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && send(input)}
          placeholder="Ask a follow-up question..."
          className="flex-1 h-7 px-2 text-xs bg-bg border border-border rounded placeholder-text-dim focus:outline-none focus:border-border-light"
          disabled={loading}
          aria-label="Ask a follow-up question"
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          className="h-7 w-7 bg-accent hover:bg-accent-hover disabled:opacity-50 rounded flex items-center justify-center"
          aria-label="Send message"
        >
          <Send className="w-3 h-3 text-white" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
