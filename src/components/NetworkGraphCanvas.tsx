import { Building2, Layers, Plane, Route, ShieldCheck } from 'lucide-react';

export type CategoryKey = 'airports' | 'layers' | 'airlines' | 'routes' | 'audits';

export interface CategoryNode {
  key: CategoryKey;
  countLabel: string;
  label: string;
  subtitle: string;
}

export interface LeafNode {
  id: string;
  category: CategoryKey;
  title: string;
  metricLabel: string;
  metricValue: number;
  barsCount: 1 | 2 | 3;
  tone: 'emerald' | 'amber' | 'red' | 'sky';
  meta?: Record<string, unknown>;
}

interface NetworkGraphCanvasProps {
  rootTitle: string;
  rootSubtitle: string;
  rootGapLabel: string;
  categories: CategoryNode[];
  activeCategory: CategoryKey;
  onSelectCategory: (cat: CategoryKey) => void;
  leaves: LeafNode[];
  selectedLeafId: string | null;
  onSelectLeaf: (leaf: LeafNode) => void;
  zoom: number;
}

const CAT_ICONS: Record<CategoryKey, typeof Plane> = {
  airports: Building2,
  layers: Layers,
  airlines: Plane,
  routes: Route,
  audits: ShieldCheck,
};

function renderSeverityBars(count: 1 | 2 | 3, tone: LeafNode['tone']) {
  const color =
    tone === 'emerald'
      ? 'bg-emerald-400'
      : tone === 'amber'
        ? 'bg-amber-400'
        : tone === 'red'
          ? 'bg-rose-500'
          : 'bg-sky-400';
  return (
    <span className="inline-flex items-center gap-[2px]">
      {Array.from({ length: 3 }).map((_, idx) => (
        <span
          key={idx}
          className={`inline-block h-2 w-1.5 rounded-[1px] ${idx < count ? color : 'bg-white/15'}`}
        />
      ))}
    </span>
  );
}

export function NetworkGraphCanvas({
  rootTitle,
  rootSubtitle,
  rootGapLabel,
  categories,
  activeCategory,
  onSelectCategory,
  leaves,
  selectedLeafId,
  onSelectLeaf,
  zoom,
}: NetworkGraphCanvasProps) {
  const svgW = 920;
  const svgH = 660;

  const rootX = 805;
  const rootY = svgH / 2;

  const catX = 615;
  const catCardW = 172;
  const catCardH = 64;
  const catSpacing = 98;
  const catStartY = rootY - ((categories.length - 1) * catSpacing) / 2;

  const activeCatIndex = Math.max(
    0,
    categories.findIndex((c) => c.key === activeCategory)
  );
  const activeCatY = catStartY + activeCatIndex * catSpacing;

  const visibleLeaves = leaves.slice(0, 14);
  const leafCount = visibleLeaves.length;
  const leafSpan = Math.min(540, Math.max(220, leafCount * 38));
  const leafStartY = svgH / 2 - leafSpan / 2;
  const leafStepY = leafCount > 1 ? leafSpan / (leafCount - 1) : 0;

  // Arc curvature fanning leftwards in RTL orientation
  const getLeafPos = (idx: number) => {
    const y = leafCount === 1 ? svgH / 2 : leafStartY + idx * leafStepY;
    const norm = leafCount > 1 ? (idx / (leafCount - 1)) * 2 - 1 : 0; // -1 to 1
    const arcOffset = Math.pow(norm, 2) * 65;
    const x = 245 + arcOffset;
    return { x, y };
  };

  return (
    <div dir="rtl" className="relative h-full min-h-[580px] w-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#060e0e]/40 select-none">
      {/* Subtle radial atmosphere behind root orb (right side in RTL) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 86% 50%, rgba(45, 118, 110, 0.14) 0%, rgba(11, 22, 22, 0.04) 42%, transparent 70%)',
        }}
      />

      {leaves.length === 0 ? (
        <div className="pointer-events-none absolute inset-y-0 start-4 flex items-center z-10">
          <div className="rounded-lg border border-white/10 bg-[#0b1516]/90 px-3.5 py-2 text-xs text-slate-300">
            لا توجد عقد مطابقة في هذه الفئة · اضغط <span className="font-mono text-[#ebd8ab]">Enter</span> للبحث في السجل
          </div>
        </div>
      ) : leaves.length > 14 ? (
        <div className="pointer-events-none absolute bottom-3 start-3 z-10 text-[10.5px] text-slate-400">
          أعلى 14 من أصل {leaves.length} عقدة · استخدم البحث للتصفية
        </div>
      ) : null}

      <div
        dir="rtl"
        className="relative h-full w-full transition-transform duration-200 ease-out"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: '50% 50%',
        }}
      >
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="h-full w-full min-h-[580px]"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <radialGradient id="rootOrbGrad" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#d8ccff" />
              <stop offset="48%" stopColor="#7c6be6" />
              <stop offset="100%" stopColor="#261f54" />
            </radialGradient>
            <radialGradient id="rootHaloGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(167, 139, 250, 0.28)" />
              <stop offset="65%" stopColor="rgba(45, 108, 108, 0.08)" />
              <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
            </radialGradient>
            <linearGradient id="goldBranch" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#e5d2a4" stopOpacity="0.95" />
              <stop offset="70%" stopColor="#bfa977" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#e9d8af" stopOpacity="0.95" />
            </linearGradient>
          </defs>

          {/* Concentric Root Radar Halo */}
          <circle cx={rootX} cy={rootY} r={112} fill="url(#rootHaloGrad)" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          <circle cx={rootX} cy={rootY} r={52} fill="none" stroke="rgba(167,139,250,0.28)" strokeDasharray="2 3" strokeWidth={1.2} />
          <circle cx={rootX} cy={rootY} r={34} fill="none" stroke="rgba(217,190,139,0.22)" strokeWidth={1} />

          {/* Waveform spikes around core orb */}
          {Array.from({ length: 48 }).map((_, i) => {
            const angle = (i / 48) * Math.PI * 2;
            const r1 = 30;
            const r2 = 34 + ((i * 7) % 11);
            return (
              <line
                key={i}
                x1={rootX + Math.cos(angle) * r1}
                y1={rootY + Math.sin(angle) * r1}
                x2={rootX + Math.cos(angle) * r2}
                y2={rootY + Math.sin(angle) * r2}
                stroke="rgba(167,139,250,0.45)"
                strokeWidth={1.1}
              />
            );
          })}

          {/* Root -> Category Curves (Right to Center) */}
          {categories.map((cat, idx) => {
            const cy = catStartY + idx * catSpacing;
            const isActive = cat.key === activeCategory;
            const startX = rootX - 34;
            const endX = catX + catCardW / 2;
            const c1x = startX - (startX - endX) * 0.55;
            const c2x = endX + (startX - endX) * 0.4;
            const d = `M ${startX} ${rootY} C ${c1x} ${rootY}, ${c2x} ${cy}, ${endX} ${cy}`;
            return (
              <path
                key={cat.key}
                d={d}
                fill="none"
                stroke={isActive ? 'url(#goldBranch)' : 'rgba(255,255,255,0.16)'}
                strokeWidth={isActive ? 1.8 : 1}
              />
            );
          })}

          {/* Active Category -> Leaf Curves (Center to Left) */}
          {visibleLeaves.map((leaf, idx) => {
            const pos = getLeafPos(idx);
            const startX = catX - catCardW / 2;
            const endX = pos.x + 8;
            const c1x = startX - (startX - endX) * 0.45;
            const c2x = endX + (startX - endX) * 0.45;
            const d = `M ${startX} ${activeCatY} C ${c1x} ${activeCatY}, ${c2x} ${pos.y}, ${endX} ${pos.y}`;
            const isSelected = leaf.id === selectedLeafId;
            return (
              <g key={leaf.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={isSelected ? '#f2dfb3' : 'url(#goldBranch)'}
                  strokeOpacity={isSelected ? 1 : 0.55}
                  strokeWidth={isSelected ? 2.1 : 1.15}
                />
                <circle
                  cx={endX}
                  cy={pos.y}
                  r={isSelected ? 4.2 : 2.6}
                  fill={isSelected ? '#fff3d1' : '#dec999'}
                />
              </g>
            );
          })}

          {/* Central Glowing Orb */}
          <circle cx={rootX} cy={rootY} r={22} fill="url(#rootOrbGrad)" />
          <circle cx={rootX - 5} cy={rootY - 6} r={6} fill="rgba(255,255,255,0.45)" />

          {/* Root Labels via foreignObject for crisp RTL Arabic shaping */}
          <foreignObject x={rootX - 95} y={rootY - 76} width={190} height={44}>
            <div dir="rtl" className="flex flex-col items-center text-center leading-tight">
              <span className="font-display text-[13px] font-semibold text-slate-100">
                {rootTitle}
              </span>
              <span className="mt-0.5 font-mono text-[10px] text-slate-400">
                {rootSubtitle}
              </span>
            </div>
          </foreignObject>

          <foreignObject x={rootX - 105} y={rootY + 46} width={210} height={28}>
            <div dir="rtl" className="text-center font-mono text-[10px] text-slate-400">
              {rootGapLabel}
            </div>
          </foreignObject>

          {/* Level 1 Category Cards */}
          {categories.map((cat, idx) => {
            const cy = catStartY + idx * catSpacing;
            const isActive = cat.key === activeCategory;
            const Icon = CAT_ICONS[cat.key];
            return (
              <foreignObject
                key={cat.key}
                x={catX - catCardW / 2}
                y={cy - catCardH / 2}
                width={catCardW}
                height={catCardH}
              >
                <button
                  dir="rtl"
                  type="button"
                  onClick={() => onSelectCategory(cat.key)}
                  className={`flex h-full w-full flex-col justify-center rounded-lg border px-3.5 py-2 text-start transition-all duration-150 ${
                    isActive
                      ? 'border-[#d9be8b] bg-[#14201f]/95 shadow-[0_0_24px_rgba(217,190,139,0.18)]'
                      : 'border-white/15 bg-[#0c1415]/90 hover:border-white/30 hover:bg-[#111d1e]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isActive ? 'text-[#e5d2a4]' : 'text-sky-400/80'
                      }`}
                    />
                    <span className="font-mono text-base font-semibold leading-none text-white tabular-nums">
                      {cat.countLabel}
                    </span>
                  </div>
                  <div className="mt-1.5 truncate text-[11px] font-medium text-slate-300">
                    {cat.label}
                  </div>
                </button>
              </foreignObject>
            );
          })}

          {/* Level 2 Leaf Labels (Left side arc in RTL flow) */}
          {visibleLeaves.map((leaf, idx) => {
            const pos = getLeafPos(idx);
            const isSelected = leaf.id === selectedLeafId;
            return (
              <foreignObject
                key={leaf.id}
                x={pos.x - 232}
                y={pos.y - 21}
                width={230}
                height={42}
              >
                <button
                  dir="rtl"
                  type="button"
                  onClick={() => onSelectLeaf(leaf)}
                  className={`group flex w-full flex-col items-start rounded px-2 py-0.5 text-start transition-colors ${
                    isSelected ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                >
                  <div
                    className={`w-full truncate text-[11.5px] font-medium leading-tight ${
                      isSelected ? 'text-[#f3e4bd]' : 'text-slate-200 group-hover:text-white'
                    }`}
                  >
                    {leaf.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] text-slate-400 tabular-nums">
                    <span>{leaf.metricLabel}</span>
                    {renderSeverityBars(leaf.barsCount, leaf.tone)}
                  </div>
                </button>
              </foreignObject>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
