import { useMemo, useRef, useEffect } from "react";
import { TrendingUp, TrendingDown, Users, BarChart2, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────
//  Sparkline (SVG mini-chart)
// ─────────────────────────────────────────────
function Sparkline({ data = [], color = "#00FFA3", height = 32 }) {
  const points = useMemo(() => {
    if (!data.length) return "";
    const vals  = data.map(d => (typeof d === "object" ? d.yes : d));
    const min   = Math.min(...vals);
    const max   = Math.max(...vals);
    const range = max - min || 1;
    const w     = 100;
    const step  = w / (vals.length - 1 || 1);
    return vals
      .map((v, i) => {
        const x = i * step;
        const y = height - ((v - min) / range) * height;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [data, height]);

  const trend = useMemo(() => {
    if (data.length < 2) return 0;
    const vals  = data.map(d => (typeof d === "object" ? d.yes : d));
    return vals[vals.length - 1] - vals[0];
  }, [data]);

  const lineColor = trend >= 0 ? "#00FFA3" : "#FF4B4B";

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {points && (
        <path
          d={points}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

// ─────────────────────────────────────────────
//  Category badge
// ─────────────────────────────────────────────
const CATEGORY_COLORS = {
  Politics: "bg-blue-500/15 text-blue-400",
  Crypto:   "bg-amber-500/15 text-amber-400",
  Sports:   "bg-purple-500/15 text-purple-400",
  Culture:  "bg-pink-500/15 text-pink-400",
};

// ─────────────────────────────────────────────
//  MarketCard
// ─────────────────────────────────────────────
export default function MarketCard({ market, onClick }) {
  const {
    question,
    category,
    yes_price   = 0.5,
    no_price    = 0.5,
    volume_24h  = 0,
    num_traders = 0,
    image_url,
    price_history = [],
  } = market;

  // Generate mock sparkline if no history
  const sparklineData = useMemo(() => {
    if (price_history.length >= 8) return price_history.slice(-24);
    // Generate realistic-looking walk from current yes_price
    const points = [];
    let price = yes_price;
    for (let i = 0; i < 24; i++) {
      price += (Math.random() - 0.5) * 0.04;
      price = Math.max(0.02, Math.min(0.98, price));
      points.push({ yes: price });
    }
    points.push({ yes: yes_price }); // ensure ends at current
    return points;
  }, [price_history, yes_price]);

  const trend = sparklineData.length >= 2
    ? sparklineData[sparklineData.length - 1].yes - sparklineData[0].yes
    : 0;

  const isBullish = yes_price > 0.5;
  const badgeClass = CATEGORY_COLORS[category] ?? "bg-neutral-700 text-neutral-400";

  const formatVolume = (v) => {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
    return `$${v}`;
  };

  return (
    <button
      onClick={onClick}
      className="
        group w-full text-left rounded-xl border border-neutral-800
        bg-neutral-900 hover:border-neutral-600 hover:bg-neutral-800/50
        transition-all duration-200 overflow-hidden
        focus:outline-none focus:ring-1 focus:ring-emerald-500/50
      "
    >
      {/* Image strip (if available) */}
      {image_url && (
        <div className="h-20 overflow-hidden relative">
          <img
            src={image_url}
            alt=""
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-neutral-900" />
        </div>
      )}

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}>
            {category}
          </span>

          {/* 24h trend indicator */}
          <span className={`flex items-center gap-0.5 text-[10px] font-mono ${trend >= 0 ? "text-green-400" : "text-red-400"}`}>
            {trend >= 0
              ? <TrendingUp size={9} />
              : <TrendingDown size={9} />
            }
            {trend >= 0 ? "+" : ""}{(trend * 100).toFixed(1)}%
          </span>
        </div>

        {/* Question */}
        <p className="text-sm font-medium text-white leading-snug mb-4 line-clamp-2 min-h-[2.5rem]">
          {question}
        </p>

        {/* Probability bars */}
        <div className="space-y-2 mb-4">
          {/* YES bar */}
          <div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-green-400 font-semibold">YES</span>
              <span className="text-green-400 font-mono font-bold">{(yes_price * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-700"
                style={{ width: `${yes_price * 100}%` }}
              />
            </div>
          </div>

          {/* NO bar */}
          <div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-red-400 font-semibold">NO</span>
              <span className="text-red-400 font-mono font-bold">{(no_price * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-red-500 rounded-full transition-all duration-700"
                style={{ width: `${no_price * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Sparkline */}
        <div className="mb-4 opacity-70 group-hover:opacity-100 transition-opacity">
          <Sparkline data={sparklineData} height={28} />
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between text-[10px] text-neutral-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <BarChart2 size={9} />
              {formatVolume(volume_24h)}
            </span>
            <span className="flex items-center gap-1">
              <Users size={9} />
              {num_traders >= 1000
                ? `${(num_traders / 1000).toFixed(1)}K`
                : num_traders
              }
            </span>
          </div>

          <span className="flex items-center gap-0.5 text-neutral-400 group-hover:text-emerald-400 transition-colors">
            Trade
            <ChevronRight size={10} />
          </span>
        </div>
      </div>
    </button>
  );
}
