// The two charts, drawn here as SVG on the kit's --c-* roles (there is no
// chart in the kit; lift these into it when a second plugin needs one). Each
// is drawn at the width it has, so its words stay 11px on a phone too.

import { useEffect, useRef, useState } from "react";
import { num, type Series } from "./model";

function useWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    set();
    const watch = new ResizeObserver(set);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, width];
}

function niceStep(max: number): number {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200]) if (max / step <= 5) return step;
  return Math.ceil(max / 5);
}

function path(points: { x: number; y: number }[], X: (x: number) => number, Y: (y: number) => number): string {
  return points.map((p, k) => `${k ? "L" : "M"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join("");
}

export function ScopeChart({ s, unit, label }: { s: Series; unit: string; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 200;
  const left = 34, right = width - 12, top = 14, bottom = height - 22;
  const step = niceStep(s.max);
  const top_ = Math.max(step, Math.ceil(s.max / step) * step);
  const X = (x: number) => left + (x / Math.max(1, s.slots)) * (right - left);
  const Y = (y: number) => bottom - (y / top_) * (bottom - top);
  const ticks: number[] = [];
  for (let v = 0; v <= top_ + 1e-9; v += step) ticks.push(v);
  const end = s.projection[s.projection.length - 1];
  const scopeNow = s.scope[s.scope.length - 1]?.y ?? 0;
  const lastDone = s.done[s.done.length - 1];
  return (
    <div ref={ref} className="sp-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
        <g className="sp-g-grid">{ticks.map((v) => <path key={v} d={`M${left} ${Y(v)}H${right}`} />)}</g>
        <g className="sp-g-txt" textAnchor="end">{ticks.map((v) => <text key={v} x={left - 8} y={Y(v) + 4}>{num(v)}</text>)}</g>
        {s.todayX != null ? <path className="sp-g-today" d={`M${X(s.todayX)} ${top}V${bottom}`} /> : null}
        <path className="sp-g-target" d={path(s.target, X, Y)} />
        <path className="sp-g-scope" d={path(s.scope, X, Y)} />
        {s.future.length ? <path className="sp-g-future" d={path(s.future, X, Y)} /> : null}
        <path className="sp-g-started" d={path(s.started, X, Y)} />
        <path className="sp-g-done" d={path(s.done, X, Y)} />
        {s.projection.length ? <path className="sp-g-proj" d={path(s.projection, X, Y)} /> : null}
        {lastDone && s.todayX != null ? <circle className="sp-g-dot" cx={X(lastDone.x)} cy={Y(lastDone.y)} r={3.5} /> : null}
        {s.steps.map((st) => (
          <g key={st.n}>
            <circle className="sp-g-mk" cx={X(st.x)} cy={Y(st.y)} r={8} />
            <text className="sp-g-mkt" x={X(st.x)} y={Y(st.y) + 3.5} textAnchor="middle">{st.n}</text>
          </g>
        ))}
        <g className="sp-g-txt">
          {s.labels.map((l, k) => (
            <text key={k} x={X(l.x)} y={height - 4} textAnchor={k === 0 ? "start" : k === s.labels.length - 1 ? "end" : "middle"}>{l.text}</text>
          ))}
          {s.todayX != null && Math.abs(X(s.todayX) - X(s.labels[1]?.x ?? -9)) > 36 ? (
            <text x={X(s.todayX)} y={height - 4} textAnchor="middle">today</text>
          ) : null}
          {end ? <text x={right - 4} y={Math.max(top + 10, Y(end.y) - 6)} textAnchor="end">at this pace: {num(end.y)} of {num(scopeNow)} {unit}</text> : null}
        </g>
      </svg>
    </div>
  );
}

export interface Bar { label: string; scope: number; done: number; carried: number; now?: boolean }

export function SixSprints({ bars, unit }: { bars: Bar[]; unit: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(520);
  const height = 160;
  const left = 50, right = width - 6, base = 115, top = 22;
  const max = Math.max(1, ...bars.map((b) => Math.max(b.scope, b.done)));
  const slot = (right - left) / Math.max(1, bars.length);
  const bw = Math.min(26, (slot - 12) / 2);
  const H = (v: number) => (v / max) * (base - top);
  const label = bars.map((b) => `Sprint ${b.label}: ${num(b.done)} of ${num(b.scope)} ${unit} done, ${b.carried} carried`).join("; ");
  return (
    <div ref={ref} className="sp-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
        {bars.map((b, k) => {
          const x = left + k * slot + (slot - 2 * bw - 2) / 2;
          return (
            <g key={b.label}>
              <rect className="sp-g-bscope" x={x} y={base - H(b.scope)} width={bw} height={H(b.scope)} />
              <rect className="sp-g-bdone" x={x + bw + 2} y={base - H(b.done)} width={bw} height={H(b.done)} />
              {b.now ? <rect className="sp-g-now" x={x - 4} y={top - 6} width={2 * bw + 10} height={base - top + 10} /> : null}
              <text className="sp-g-txt" x={x + bw + 2 + bw / 2} y={base - H(b.done) - 4} textAnchor="middle">{num(b.done)}</text>
              <text className="sp-g-txt" x={x + bw + 1} y={base + 17} textAnchor="middle">{b.label}</text>
              <text className="sp-g-txt" x={x + bw + 1} y={base + 37} textAnchor="middle">{b.carried}</text>
            </g>
          );
        })}
        <g className="sp-g-txt"><text x={0} y={base + 17}>sprint</text><text x={0} y={base + 37}>carried</text></g>
      </svg>
    </div>
  );
}
