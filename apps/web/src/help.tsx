import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Leaf } from "lucide-react";
import guide from "../../../docs/user-guide.md?raw";
import integrations from "../../../docs/health-integrations.md?raw";
import release from "../../../docs/public-release.md?raw";
import specification from "../../../docs/mvp-spec.md?raw";
import "./style.css";
const sections = [
  { id: "guide", label: "Using OutFit", body: guide },
  { id: "integrations", label: "Health integrations", body: integrations },
  { id: "setup", label: "Hosting & privacy", body: release },
  { id: "spec", label: "Project specification", body: specification },
];
const documentIds: Record<string, string> = {
  "user-guide.md": "guide",
  "health-integrations.md": "integrations",
  "public-release.md": "setup",
  "mvp-spec.md": "spec",
};
function Help() {
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get("doc") ?? "guide",
  );
  const document = sections.find((s) => s.id === selected) ?? sections[0];
  useEffect(() => {
    const update = () =>
      setSelected(new URLSearchParams(location.search).get("doc") ?? "guide");
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  function select(id: string) {
    history.pushState(null, "", `?doc=${id}`);
    setSelected(id);
    window.scrollTo(0, 0);
  }
  return (
    <div className="help-shell">
      <a className="skip-link" href="#help-content">
        Skip to documentation
      </a>
      <header className="help-header">
        <a className="brand" href="./">
          <span className="brand-icon">
            <Leaf size={23} />
          </span>
          OutFit<span className="brand-dot">.</span>
        </a>
        <a className="button secondary" href="./">
          <ArrowLeft size={16} /> Back to OutFit
        </a>
      </header>
      <div className="help-layout">
        <nav className="help-nav" aria-label="Help topics">
          <h2>Help & documentation</h2>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`?doc=${s.id}`}
              aria-current={document.id === s.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                select(s.id);
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <main id="help-content" className="card help-document">
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            disallowedElements={["img"]}
            urlTransform={(url) => {
              const file = url.split("/").at(-1)?.split("#")[0] ?? "";
              return documentIds[file]
                ? `?doc=${documentIds[file]}`
                : defaultUrlTransform(url);
            }}
            components={{
              table: ({ children }) => <table tabIndex={0}>{children}</table>,
              pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
              a: ({ href, children }) =>
                href?.startsWith("?doc=") ? (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      select(
                        new URLSearchParams(href.slice(1)).get("doc") ??
                          "guide",
                      );
                    }}
                  >
                    {children}
                  </a>
                ) : (
                  <a href={href} rel="noopener noreferrer">
                    {children}
                  </a>
                ),
            }}
          >
            {document.body}
          </Markdown>
        </main>
      </div>
      <footer className="app-footer">
        <span>OutFit · Make room for outside.</span>
        <span>General fitness support for adults.</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Help />);
