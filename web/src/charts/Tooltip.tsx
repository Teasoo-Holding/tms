import { createContext, ReactNode, useContext, useState } from 'react';

export interface TooltipContent {
  title: string;
  rows: { label: string; value: string; color?: string }[];
}
interface State extends TooltipContent {
  x: number;
  y: number;
}

const Ctx = createContext<{ show: (c: TooltipContent, x: number, y: number) => void; hide: () => void }>({ show: () => {}, hide: () => {} });

/** One shared tooltip for all charts. Labels render as text nodes (data is untrusted). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  return (
    <Ctx.Provider value={{ show: (c, x, y) => setState({ ...c, x, y }), hide: () => setState(null) }}>
      {children}
      {state && (
        <div className="tooltip" style={{ left: Math.min(state.x + 14, window.innerWidth - 220), top: state.y + 14 }} role="status">
          <div className="muted">{state.title}</div>
          {state.rows.map((r, i) => (
            <div key={i}>
              <strong>{r.value}</strong>
              <span className="subtle">
                {r.color && <span className="key" style={{ background: r.color }} />}
                {r.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Props that make an SVG mark hoverable and keyboard-focusable with the same tooltip. */
export function useMarkTooltip() {
  const { show, hide } = useContext(Ctx);
  return (content: TooltipContent) => ({
    tabIndex: 0,
    onPointerMove: (e: React.PointerEvent) => show(content, e.clientX, e.clientY),
    onPointerLeave: hide,
    onFocus: (e: React.FocusEvent<SVGElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      show(content, r.right, r.top);
    },
    onBlur: hide,
    'aria-label': `${content.title}: ${content.rows.map((r) => `${r.label} ${r.value}`).join(', ')}`,
  });
}
