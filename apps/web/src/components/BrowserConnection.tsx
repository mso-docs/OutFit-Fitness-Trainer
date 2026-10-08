import { useEffect, useState } from "react";
import { api } from "../api";
export function BrowserConnection({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}) {
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:11434");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ ollamaURL: string }>("/ai/connection")
      .then((v) => setEndpoint(v.ollamaURL))
      .catch(() => setNotice("Could not read your connection settings."));
  }, []);
  return (
    <section className="card">
      <h2>Ollama on your computer</h2>
      <p className="muted">
        This version runs in your browser without the OutFit server. Profile,
        plans and logs stay in this browser’s storage. AI requests go directly
        to the address you choose.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setNotice("");
          try {
            await api("/ai/connection", "PUT", { ollamaURL: endpoint });
            await onSaved();
            setNotice("Connection saved. Select an installed model below.");
          } catch (e) {
            setNotice(
              e instanceof Error ? e.message : "Could not save the connection.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Ollama address
          <input
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            required
            disabled={busy}
          />
        </label>
        <p className="small muted">
          Default: http://127.0.0.1:11434. To use another machine, enter a
          trusted endpoint; activity context and chat will be sent there.
        </p>
        <button className="button secondary" disabled={busy}>
          Save Ollama connection
        </button>
        <p role="status">{notice}</p>
      </form>
      <details>
        <summary>Connection help</summary>
        <p>
          Add this site’s exact origin to Ollama’s <code>OLLAMA_ORIGINS</code>,
          then restart Ollama. Allow local-network access if your browser asks.
          Avoid a wildcard origin. Keep Ollama bound to localhost for
          same-computer use.
        </p>
        <p>
          Site origin: <code>{location.origin}</code>. If your browser blocks
          the connection, use the optional local OutFit server instead. Phone
          localhost refers to the phone.
        </p>
      </details>
    </section>
  );
}
