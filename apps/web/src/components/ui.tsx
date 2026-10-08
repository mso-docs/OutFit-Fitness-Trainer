import { useEffect, useRef, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { flagNames } from "../shared";
export function Landscape() {
  return (
    <svg className="landscape" viewBox="0 0 650 330" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x2="0" y2="1">
          <stop stopColor="#d7e7df" />
          <stop offset="1" stopColor="#eef0d9" />
        </linearGradient>
        <linearGradient id="hill" x2="0" y2="1">
          <stop stopColor="#8fa58d" />
          <stop offset="1" stopColor="#547b65" />
        </linearGradient>
      </defs>
      <rect width="650" height="330" fill="url(#sky)" />
      <circle cx="462" cy="79" r="32" fill="#f3d68c" />
      <path d="M0 185Q100 78 225 175T480 140T650 140V330H0Z" fill="#b2c5af" />
      <path
        d="M0 245Q110 110 272 232Q400 140 650 194V330H0Z"
        fill="url(#hill)"
      />
      <path d="M0 300Q210 182 385 280Q500 245 650 256V330H0Z" fill="#365c49" />
      <path
        d="M420 330Q365 290 388 270T395 245Q395 236 380 231"
        stroke="#cfce9d"
        strokeWidth="16"
        fill="none"
      />
      <g fill="#254936">
        <path d="M557 272v-95l-34 65h20l-24 32z" />
        <path d="M596 282V162l-40 76h22l-26 41z" />
      </g>
      <g stroke="#8c9d7d" strokeWidth="2">
        <path d="M45 330v-26m0 14l-10-12m10 17l10-16M72 330v-22m0 8l-9-8m9 14l8-14" />
      </g>
    </svg>
  );
}
export function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const items = Array.from(
          ref.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]',
          ),
        ).filter((el) => el.getClientRects().length > 0);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function SafetyFields({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="safety-options">
      <legend>Do any of these apply right now?</legend>
      <p className="muted">
        Recommendations pause when a flag is selected. You can still log
        activity and view your history.
      </p>
      {Object.entries(flagNames).map(([value, label]) => (
        <label className="checkbox-row" key={value}>
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, value]
                  : selected.filter((x) => x !== value),
              )
            }
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
