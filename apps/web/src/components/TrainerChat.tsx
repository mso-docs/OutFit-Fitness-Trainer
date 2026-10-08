import { useState } from "react";
import { MessageCircle, Send, LoaderCircle } from "lucide-react";
import { api } from "../api";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
type Message = { role: "user" | "assistant"; content: string; source?: string };
export function TrainerChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError("");
    const next: Message[] = [
      ...messages,
      { role: "user", content: question.trim() },
    ];
    const context = next.slice(-12);
    while (
      context.length > 1 &&
      context.reduce((n, m) => n + m.content.length, 0) > 4000
    )
      context.shift();
    try {
      const reply = await api<{ answer: string; source: string }>(
        "/trainer/chat",
        "POST",
        {
          messages: context.map(({ role, content }) => ({ role, content })),
        },
      );
      setMessages([
        ...next,
        { role: "assistant", content: reply.answer, source: reply.source },
      ]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send your question.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card trainer-card">
      <div className="card-title">
        <MessageCircle size={22} />
        <h2>Chat with your trainer</h2>
      </div>
      <p className="muted">
        Talk through your plan, build a habit, or find a little motivation. Your
        trainer can explain your plan; changes still go through a plan preview.
      </p>
      <p className="small muted">
        Messages and your plan/activity summary are sent to your configured AI
        server. Chat is kept only on this screen and clears when you leave or
        reload. Body measurements and log notes are not included automatically.
        General fitness support, not medical advice.
      </p>
      {!messages.length && (
        <div className="trainer-suggestions">
          {[
            "Help me understand my plan",
            "How can I make walking a habit?",
            "I missed a session. What should I do?",
          ].map((q) => (
            <button
              key={q}
              className="button secondary"
              onClick={() => setQuestion(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <div
        className="trainer-thread"
        role="log"
        aria-label="Trainer conversation"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((m, i) => (
          <div className={"chat-message " + m.role} key={i}>
            <strong>
              {m.role === "user"
                ? "You"
                : m.source === "ollama"
                  ? "AI trainer"
                  : m.source === "safety"
                    ? "Safety guidance"
                    : "Connection notice"}
            </strong>
            {m.role === "assistant" ? (
              <div className="chat-markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  disallowedElements={["img"]}
                  components={{
                    a: ({ children, href }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {m.content}
                </Markdown>
              </div>
            ) : (
              <p>{m.content}</p>
            )}
          </div>
        ))}
      </div>
      {busy && (
        <p role="status">
          <LoaderCircle size={16} className="spin" /> Your trainer is thinking.
          This may take a minute.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label>
          Your question
          <textarea
            maxLength={2000}
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            disabled={busy}
            placeholder="What would you like to talk through?"
          />
        </label>
        <div className="form-actions">
          <button className="button" disabled={busy || !question.trim()}>
            <Send size={17} /> Send message
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy || !messages.length}
            onClick={() => {
              setMessages([]);
              setError("");
            }}
          >
            Clear conversation
          </button>
        </div>
      </form>
    </section>
  );
}
