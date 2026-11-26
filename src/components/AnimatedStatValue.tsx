import { useEffect, useRef, useState } from 'react';

interface AnimatedStatValueProps {
  value: number | string;
  loading?: boolean;
  durationMs?: number;
  className?: string;
}

interface ParsedSegment {
  type: 'text' | 'number';
  raw: string;
  target: number;
  decimals: number;
}

function parseValueSegments(input: number | string): ParsedSegment[] {
  const str = typeof input === 'number' ? input.toLocaleString('en-US') : String(input);
  const regex = /(\d[\d,]*(?:\.\d+)?)/g;
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  for (const match of str.matchAll(regex)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      segments.push({ type: 'text', raw: str.slice(lastIndex, idx), target: 0, decimals: 0 });
    }
    const token = match[0];
    const clean = token.replace(/,/g, '');
    const numeric = Number(clean);
    const dotIdx = clean.indexOf('.');
    const decimals = dotIdx >= 0 ? clean.length - dotIdx - 1 : 0;

    if (Number.isFinite(numeric)) {
      segments.push({ type: 'number', raw: token, target: numeric, decimals });
    } else {
      segments.push({ type: 'text', raw: token, target: 0, decimals: 0 });
    }
    lastIndex = idx + token.length;
  }

  if (lastIndex < str.length) {
    segments.push({ type: 'text', raw: str.slice(lastIndex), target: 0, decimals: 0 });
  }

  return segments;
}

function formatInterpolated(segments: ParsedSegment[], fromTargets: number[], progress: number): string {
  let numIdx = 0;
  return segments
    .map((seg) => {
      if (seg.type === 'text') return seg.raw;
      const startVal = fromTargets[numIdx] ?? 0;
      numIdx += 1;
      const current = startVal + (seg.target - startVal) * progress;
      if (seg.decimals > 0) {
        return current.toLocaleString('en-US', {
          minimumFractionDigits: seg.decimals,
          maximumFractionDigits: seg.decimals,
        });
      }
      return Math.round(current).toLocaleString('en-US');
    })
    .join('');
}

export function AnimatedStatValue({
  value,
  loading = false,
  durationMs = 600,
  className = '',
}: AnimatedStatValueProps) {
  const [displayText, setDisplayText] = useState<string>(() =>
    typeof value === 'number' ? value.toLocaleString('en-US') : String(value)
  );
  const prevNumbersRef = useRef<number[]>([]);
  const hasAnimatedOnceRef = useRef<boolean>(false);

  useEffect(() => {
    if (loading) {
      prevNumbersRef.current = [];
      return;
    }

    const segments = parseValueSegments(value);
    const targets = segments.filter((s) => s.type === 'number').map((s) => s.target);

    if (targets.length === 0) {
      setDisplayText(String(value));
      prevNumbersRef.current = [];
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setDisplayText(formatInterpolated(segments, targets, 1));
      prevNumbersRef.current = targets;
      hasAnimatedOnceRef.current = true;
      return;
    }

    const fromTargets =
      hasAnimatedOnceRef.current && prevNumbersRef.current.length === targets.length
        ? prevNumbersRef.current
        : targets.map(() => 0);

    const isNoop = targets.every((t, i) => t === fromTargets[i]);
    if (isNoop) {
      setDisplayText(formatInterpolated(segments, targets, 1));
      hasAnimatedOnceRef.current = true;
      return;
    }

    setDisplayText(formatInterpolated(segments, fromTargets, 0));

    let rafId = 0;
    let startTime: number | null = null;

    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const elapsed = now - startTime;
      const rawProgress = Math.min(1, elapsed / durationMs);
      // Cubic ease-out for crisp initial acceleration and gentle settle
      const eased = 1 - Math.pow(1 - rawProgress, 3);

      setDisplayText(formatInterpolated(segments, fromTargets, eased));

      if (rawProgress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        prevNumbersRef.current = targets;
        hasAnimatedOnceRef.current = true;
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [value, loading, durationMs]);

  if (loading) {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-7 w-24 animate-pulse rounded bg-slate-200/80 align-middle dark:bg-white/10"
      />
    );
  }

  return <span className={`kpi-value-fade ${className}`}>{displayText}</span>;
}
