import { useEffect, useId, useRef, useState } from 'react';
import type { Term } from '../glossary';

/** An "i" button that shows a term's definition; it also shows on hover and closes on Escape or a click elsewhere. */
export function InfoTip({ term }: { term: Term }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <span className="info-tip" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="info-tip-button no-print" aria-label={`What is “${term.term}”?`} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen((v) => !v)}>
        i
      </button>
      {open && (
        <span role="tooltip" id={id} className="info-tip-text">
          {term.definition}
        </span>
      )}
    </span>
  );
}
