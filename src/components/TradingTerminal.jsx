/**
 * TradingTerminal.jsx — High-density trading component
 * - TradingView Lightweight Charts (candlestick)
 * - Buy/Sell YES/NO with slippage control
 * - Live order book
 * - Position summary + One-Click Trade mode
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount } from "wagmi";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtBps(bps) { return (bps / 100).toFixed(1) + "%"; }
function fmtUsdc(n)   {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ─── Synthetic candle data ────────────────────────────────────────────────────
function generateCandles(basePrice = 0.68, count = 120) {
  const candles = [];
  let price = basePrice;
  const now = Math.floor(Date.now() / 1000);

  for (let i = count; i >= 0; i--) {
    const delta  = (Math.random() - 0.48) * 0.025;
    const open   = price;
    const close  = Math.max(0.01, Math.min(0.99, price + delta));
    const high   = Math.max(open, close) + Math.random() * 0.012;
    const low    = Math.min(open, close) - Math.random() * 0.012;
    const volume = Math.random() * 180000 + 20000;
    candles.push({ time: now - i * 3600, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

// ─── Chart Component ──────────────────────────────────────────────────────────
function PriceChart({ yesPriceBps }) {
  const chartRef     = useRef(null);
  const containerRef = useRef(null);
  const candles      = useRef(generateCandles(yesPriceBps / 10000));

  useEffect(() => {
    if (!containerRef.current) return;

    // Lightweight Charts v4 (loaded via CDN in index.html)
    const LWC = window.LightweightCharts;
    if (!LWC) {
      // Fallback: draw simple SVG sparkline
      return;
    }

    const chart = LWC.createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor:  "#7A7A8C",
      },
      grid: {
        vertLines:  { color: "#1A1A1F" },
        horzLines:  { color: "#1A1A1F" },
      },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: "#6366F1", style: 1, width: 1 },
        horzLine: { color: "#6366F1", style: 1, width: 1 },
      },
      rightPriceScale: { borderColor: "#242429" },
      timeScale: { borderColor: "#242429", timeVisible: true },
      width:  containerRef.current.clientWidth,
      height: 240,
    });

    const series = chart.addCandlestickSeries({
      upColor:        "#00FFA3",
      downColor:      "#FF4B4B",
      borderUpColor:  "#00FFA3",
      borderDownColor:"#FF4B4B",
      wickUpColor:    "#00FFA3",
      wickDownColor:  "#FF4B4B",
    });

    series.setData(candles.current);
    chart.timeScale().fitContent();

    chartRef.current = { chart, series };

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth || 600 });
    });
    ro.observe(containerRef.current);

    return () => { chart.remove(); ro.disconnect(); };
  }, []);

  return (
    <div className="chart-wrapper">
      <div ref={containerRef} className="chart-container" style={{ height: 240 }}>
        {/* Fallback SVG sparkline if LWC not loaded */}
        <FallbackChart candles={candles.current} yesPriceBps={yesPriceBps} />
      </div>
    </div>
  );
}

function FallbackChart({ candles, yesPriceBps }) {
  const W = 620, H = 200;
  const prices = candles.map(c => c.close);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 0.01;

  const pts = prices.map((p, i) =>
    `${(i / (prices.length - 1)) * W},${H - ((p - min) / range) * (H - 20) - 10}`
  ).join(" ");

  const gradId = `g${Math.random().toString(36).slice(2)}`;
  const lastPrice = prices[prices.length - 1];
  const prevPrice = prices[prices.length - 2];
  const color = lastPrice >= prevPrice ? "#00FFA3" : "#FF4B4B";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%"
         style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0"   />
        </linearGradient>
      </defs>
      {/* Area fill */}
      <polygon
        points={`0,${H} ${pts} ${W},${H}`}
        fill={`url(#${gradId})`}
      />
      {/* Line */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      {/* Price labels */}
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y = H - ((min + range * t - min) / range) * (H - 20) - 10;
        return (
          <text key={t} x={W - 4} y={y + 4}
                fill="#7A7A8C" fontSize="9" textAnchor="end"
                fontFamily="'Space Mono', monospace">
            {((min + range * t) * 100).toFixed(1)}¢
          </text>
        );
      })}
    </svg>
  );
}

// ─── Order Book ───────────────────────────────────────────────────────────────
function OrderBook({ yesPriceBps }) {
  const yesPct = yesPriceBps / 100;
  const bids = Array.from({ length: 8 }, (_, i) => ({
    price: (yesPct - i * 1.2 - 0.5).toFixed(1),
    size:  (Math.random() * 50000 + 5000).toFixed(0),
    depth: Math.random(),
  }));
  const asks = Array.from({ length: 8 }, (_, i) => ({
    price: (yesPct + i * 1.2 + 0.5).toFixed(1),
    size:  (Math.random() * 40000 + 4000).toFixed(0),
    depth: Math.random(),
  }));

  return (
    <div className="order-book">
      <div className="ob-header">
        <span>PRICE (¢)</span>
        <span>SIZE (USDC)</span>
        <span>TOTAL</span>
      </div>
      <div className="ob-asks">
        {asks.slice().reverse().map((a, i) => (
          <div key={i} className="ob-row ask">
            <div className="ob-depth-bar ask" style={{ width: `${a.depth * 100}%` }} />
            <span className="ob-price bearish">{a.price}</span>
            <span className="ob-size">{Number(a.size).toLocaleString()}</span>
            <span className="ob-total">{Number(a.size * a.price / 100).toFixed(0)}</span>
          </div>
        ))}
      </div>
      <div className="ob-spread">
        <span className="ob-mid">{yesPct.toFixed(1)}¢</span>
        <span className="ob-spread-label">SPREAD: {(0.5 + Math.random()).toFixed(1)}¢</span>
      </div>
      <div className="ob-bids">
        {bids.map((b, i) => (
          <div key={i} className="ob-row bid">
            <div className="ob-depth-bar bid" style={{ width: `${b.depth * 100}%` }} />
            <span className="ob-price bullish">{b.price}</span>
            <span className="ob-size">{Number(b.size).toLocaleString()}</span>
            <span className="ob-total">{Number(b.size * b.price / 100).toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Trade Panel ──────────────────────────────────────────────────────────────
function TradePanel({ market, oneClickMode, setOneClickMode }) {
  const { isConnected } = useAccount();
  const [side,       setSide]       = useState("buy");
  const [outcome,    setOutcome]    = useState("YES");
  const [amount,     setAmount]     = useState("");
  const [slippage,   setSlippage]   = useState(0.5);
  const [orderType,  setOrderType]  = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [preview,    setPreview]    = useState(null);

  const yesPct = market.yesPriceBps / 100;
  const noPct  = (10000 - market.yesPriceBps) / 100;
  const currentPct = outcome === "YES" ? yesPct : noPct;

  const estimatedShares = amount
    ? (Number(amount) / (currentPct / 100)).toFixed(2)
    : null;

  const handleTrade = async () => {
    if (!isConnected) { alert("Connect your wallet to trade."); return; }
    if (!amount || Number(amount) <= 0) return;
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 1500)); // Mock tx
    setSubmitting(false);
    setAmount("");
  };

  const handleOneClick = async (buyYes) => {
    if (!isConnected) { alert("Connect your wallet to trade."); return; }
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 1000));
    setSubmitting(false);
  };

  const PRESET_AMOUNTS = [25, 100, 500, 1000];

  return (
    <div className="trade-panel">
      {/* One-Click mode toggle */}
      <div className="one-click-header">
        <span className="panel-title">TRADE</span>
        <div className="one-click-toggle">
          <span className="oc-label">ONE-CLICK</span>
          <button
            className={`toggle-btn ${oneClickMode ? "on" : "off"}`}
            onClick={() => setOneClickMode(!oneClickMode)}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>

      {oneClickMode ? (
        /* ── ONE-CLICK MODE ── */
        <div className="oc-mode">
          <div className="oc-price-row">
            <div className="oc-side yes">
              <span className="oc-outcome">YES</span>
              <span className="oc-pct">{yesPct.toFixed(1)}¢</span>
              <span className="oc-prob">{yesPct.toFixed(1)}%</span>
            </div>
            <div className="oc-divider">VS</div>
            <div className="oc-side no">
              <span className="oc-outcome">NO</span>
              <span className="oc-pct">{noPct.toFixed(1)}¢</span>
              <span className="oc-prob">{noPct.toFixed(1)}%</span>
            </div>
          </div>
          <div className="oc-buttons">
            <button
              className={`oc-btn yes ${submitting ? "loading" : ""}`}
              onClick={() => handleOneClick(true)}
              disabled={submitting}
            >
              {submitting ? "⟳" : "↑"} BUY YES
              <span className="oc-btn-sub">$100</span>
            </button>
            <button
              className={`oc-btn no ${submitting ? "loading" : ""}`}
              onClick={() => handleOneClick(false)}
              disabled={submitting}
            >
              {submitting ? "⟳" : "↓"} BUY NO
              <span className="oc-btn-sub">$100</span>
            </button>
          </div>
          <p className="oc-note">One-click trades $100 USDC with 1% slippage</p>
        </div>
      ) : (
        /* ── ADVANCED MODE ── */
        <div className="adv-mode">
          {/* Buy / Sell */}
          <div className="side-tabs">
            <button className={`side-tab ${side === "buy" ? "active-buy" : ""}`}
                    onClick={() => setSide("buy")}>BUY</button>
            <button className={`side-tab ${side === "sell" ? "active-sell" : ""}`}
                    onClick={() => setSide("sell")}>SELL</button>
          </div>

          {/* YES / NO */}
          <div className="outcome-tabs">
            <button
              className={`outcome-tab yes ${outcome === "YES" ? "active" : ""}`}
              onClick={() => setOutcome("YES")}
            >
              YES <span className="ot-price">{yesPct.toFixed(1)}¢</span>
            </button>
            <button
              className={`outcome-tab no ${outcome === "NO" ? "active" : ""}`}
              onClick={() => setOutcome("NO")}
            >
              NO <span className="ot-price">{noPct.toFixed(1)}¢</span>
            </button>
          </div>

          {/* Order type */}
          <div className="order-type-tabs">
            {["market", "limit"].map(t => (
              <button key={t}
                className={`ot-tab ${orderType === t ? "active" : ""}`}
                onClick={() => setOrderType(t)}
              >{t.toUpperCase()}</button>
            ))}
          </div>

          {/* Limit price (if limit order) */}
          {orderType === "limit" && (
            <div className="input-group">
              <label>LIMIT PRICE (¢)</label>
              <div className="input-wrapper">
                <input
                  type="number"
                  placeholder={currentPct.toFixed(1)}
                  value={limitPrice}
                  onChange={e => setLimitPrice(e.target.value)}
                  className="trade-input"
                />
                <span className="input-suffix">¢</span>
              </div>
            </div>
          )}

          {/* Amount */}
          <div className="input-group">
            <div className="input-label-row">
              <label>AMOUNT</label>
              <span className="input-balance">BAL: $1,250.00</span>
            </div>
            <div className="input-wrapper">
              <span className="input-prefix">$</span>
              <input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="trade-input"
              />
              <button className="input-max" onClick={() => setAmount("1250")}>MAX</button>
            </div>
            <div className="preset-amounts">
              {PRESET_AMOUNTS.map(p => (
                <button key={p} className="preset-btn" onClick={() => setAmount(String(p))}>${p}</button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {amount && Number(amount) > 0 && (
            <div className="trade-preview">
              <div className="preview-row">
                <span>Est. Shares</span>
                <span>{estimatedShares} {outcome}</span>
              </div>
              <div className="preview-row">
                <span>Avg Price</span>
                <span>{currentPct.toFixed(2)}¢</span>
              </div>
              <div className="preview-row">
                <span>Price Impact</span>
                <span className={Number(amount) > 1000 ? "bearish" : "bullish"}>
                  {(Number(amount) / 100000).toFixed(2)}%
                </span>
              </div>
              <div className="preview-row">
                <span>Max Payout</span>
                <span className="bullish">${(Number(estimatedShares) * 1).toFixed(2)}</span>
              </div>
              <div className="preview-row">
                <span>Fee (1%)</span>
                <span>${(Number(amount) * 0.01).toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Slippage */}
          <div className="slippage-row">
            <span>Slippage:</span>
            {[0.5, 1, 2].map(s => (
              <button key={s} className={`slippage-btn ${slippage === s ? "active" : ""}`}
                      onClick={() => setSlippage(s)}>{s}%</button>
            ))}
          </div>

          {/* Submit */}
          <button
            className={`trade-submit ${side} ${submitting ? "submitting" : ""}`}
            onClick={handleTrade}
            disabled={!amount || submitting}
          >
            {submitting ? (
              <span className="spinner">⟳</span>
            ) : (
              `${side.toUpperCase()} ${outcome} ${amount ? `· $${amount}` : ""}`
            )}
          </button>

          {!isConnected && (
            <p className="connect-hint">Connect wallet to trade</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Terminal ────────────────────────────────────────────────────────────
export default function TradingTerminal({ market }) {
  const [oneClickMode, setOneClickMode] = useState(false);
  const [chartInterval, setChartInterval] = useState("1h");

  const yesPct = market.yesPriceBps / 100;
  const noPct  = (10000 - market.yesPriceBps) / 100;

  return (
    <div className="terminal-root">
      <style>{TERMINAL_CSS}</style>

      {/* Market Header */}
      <div className="terminal-header">
        <div className="th-left">
          <span className={`th-category cat-${market.category.toLowerCase()}`}>{market.category}</span>
          <h1 className="th-question">{market.question}</h1>
          <div className="th-meta">
            <span className="th-vol">VOL: {fmtUsdc(market.totalVolume)}</span>
            <span className="th-vol-24">24H: {fmtUsdc(market.volume24h)}</span>
            <span className="th-traders">⟡ {market.numTraders.toLocaleString()} traders</span>
          </div>
        </div>
        <div className="th-right">
          <div className="th-prices">
            <div className="th-price-block yes">
              <span className="th-outcome">YES</span>
              <span className="th-price">{yesPct.toFixed(1)}¢</span>
              <span className="th-prob">{yesPct.toFixed(1)}%</span>
            </div>
            <div className="th-prob-bar">
              <div className="th-yes-fill" style={{ width: `${yesPct}%` }} />
            </div>
            <div className="th-price-block no">
              <span className="th-outcome">NO</span>
              <span className="th-price">{noPct.toFixed(1)}¢</span>
              <span className="th-prob">{noPct.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main grid: chart + order book | trade panel */}
      <div className="terminal-body">
        <div className="terminal-left">
          {/* Chart controls */}
          <div className="chart-controls">
            <div className="chart-intervals">
              {["1m","5m","15m","1h","4h","1d"].map(i => (
                <button key={i}
                  className={`interval-btn ${chartInterval === i ? "active" : ""}`}
                  onClick={() => setChartInterval(i)}
                >{i.toUpperCase()}</button>
              ))}
            </div>
            <div className="chart-type-label">PROBABILITY · {market.question.slice(0, 30)}…</div>
          </div>

          <PriceChart yesPriceBps={market.yesPriceBps} interval={chartInterval} />

          {/* Order Book */}
          <div className="ob-wrapper">
            <div className="ob-title">ORDER BOOK</div>
            <OrderBook yesPriceBps={market.yesPriceBps} />
          </div>
        </div>

        {/* Trade Panel */}
        <TradePanel
          market={market}
          oneClickMode={oneClickMode}
          setOneClickMode={setOneClickMode}
        />
      </div>
    </div>
  );
}

const TERMINAL_CSS = `
  .terminal-root {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
  }

  /* ── Terminal Header ── */
  .terminal-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
  }
  .th-left { flex: 1; min-width: 0; margin-right: 24px; }
  .th-category {
    display: inline-block;
    font-family: var(--mono); font-size: 9px; letter-spacing: 0.12em;
    padding: 2px 7px; border-radius: 3px; margin-bottom: 6px;
  }
  .cat-politics { background: rgba(99,102,241,0.15); color: var(--accent); border: 1px solid rgba(99,102,241,0.3); }
  .cat-crypto   { background: rgba(245,158,11,0.12); color: var(--gold);   border: 1px solid rgba(245,158,11,0.3); }
  .cat-sports   { background: rgba(0,255,163,0.08);  color: var(--bullish);border: 1px solid rgba(0,255,163,0.2); }
  .cat-culture  { background: rgba(255,75,75,0.10);  color: var(--bearish);border: 1px solid rgba(255,75,75,0.2); }

  .th-question { font-size: 15px; font-weight: 500; color: var(--text); line-height: 1.3; margin-bottom: 8px; }
  .th-meta { display: flex; gap: 14px; }
  .th-vol, .th-vol-24, .th-traders {
    font-family: var(--mono); font-size: 10px; color: var(--text-dim);
  }
  .th-traders { color: var(--text-sub); }

  .th-right { flex-shrink: 0; }
  .th-prices { display: flex; align-items: center; gap: 14px; }
  .th-price-block { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 54px; }
  .th-outcome { font-family: var(--mono); font-size: 9px; color: var(--text-dim); letter-spacing: 0.1em; }
  .th-price { font-family: var(--mono); font-size: 18px; font-weight: 700; }
  .th-prob  { font-family: var(--mono); font-size: 10px; color: var(--text-sub); }
  .th-price-block.yes .th-price { color: var(--bullish); }
  .th-price-block.no  .th-price { color: var(--bearish); }

  .th-prob-bar {
    width: 80px; height: 4px;
    background: rgba(255,75,75,0.4);
    border-radius: 2px; overflow: hidden;
  }
  .th-yes-fill { height: 100%; background: var(--bullish); border-radius: 2px; transition: width 0.3s; }

  /* ── Terminal Body ── */
  .terminal-body {
    display: grid;
    grid-template-columns: 1fr 280px;
    flex: 1;
    overflow: hidden;
  }
  .terminal-left {
    display: flex; flex-direction: column;
    overflow-y: auto; overflow-x: hidden;
    border-right: 1px solid var(--border);
  }
  .terminal-left::-webkit-scrollbar { width: 4px; }
  .terminal-left::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  /* ── Chart ── */
  .chart-controls {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .chart-intervals { display: flex; gap: 2px; }
  .interval-btn {
    background: none; border: none; cursor: pointer;
    font-family: var(--mono); font-size: 10px;
    color: var(--text-dim); padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.1s;
  }
  .interval-btn:hover { color: var(--text); }
  .interval-btn.active { background: rgba(99,102,241,0.15); color: var(--accent); }
  .chart-type-label { font-family: var(--mono); font-size: 9px; color: var(--text-dim); }

  .chart-wrapper { position: relative; flex-shrink: 0; overflow: hidden; }
  .chart-container {
    position: relative; width: 100%;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  /* ── Order Book ── */
  .ob-wrapper { flex: 1; overflow-y: auto; min-height: 200px; }
  .ob-title {
    padding: 10px 16px; font-family: var(--mono); font-size: 9px;
    letter-spacing: 0.1em; color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; background: var(--bg); z-index: 1;
  }
  .order-book { font-family: var(--mono); }
  .ob-header {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    padding: 6px 16px;
    font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em;
  }
  .ob-row {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    padding: 3px 16px; font-size: 11px;
    position: relative; cursor: pointer;
    transition: background 0.1s;
  }
  .ob-row:hover { background: var(--surface2); }
  .ob-depth-bar {
    position: absolute; top: 0; bottom: 0;
    opacity: 0.08; pointer-events: none;
  }
  .ob-depth-bar.ask { right: 0; background: var(--bearish); }
  .ob-depth-bar.bid { left:  0; background: var(--bullish); }
  .ob-price { font-weight: 700; }
  .ob-size, .ob-total { color: var(--text-sub); }
  .ob-spread {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 16px;
    background: rgba(99,102,241,0.05);
    border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
  }
  .ob-mid { font-size: 13px; font-weight: 700; color: var(--accent); }
  .ob-spread-label { font-size: 9px; color: var(--text-dim); }

  /* ── Trade Panel ── */
  .trade-panel {
    display: flex; flex-direction: column;
    overflow-y: auto; padding: 14px 14px;
    background: var(--surface);
    gap: 10px;
  }
  .trade-panel::-webkit-scrollbar { width: 4px; }
  .trade-panel::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  .one-click-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 4px;
  }
  .panel-title { font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; color: var(--text-dim); }
  .one-click-toggle { display: flex; align-items: center; gap: 7px; }
  .oc-label { font-family: var(--mono); font-size: 9px; color: var(--text-dim); }
  .toggle-btn {
    width: 36px; height: 18px;
    border-radius: 9px; border: none; cursor: pointer;
    position: relative; transition: background 0.2s;
    padding: 0;
  }
  .toggle-btn.on  { background: var(--bullish); }
  .toggle-btn.off { background: var(--border2); }
  .toggle-knob {
    position: absolute; top: 2px; width: 14px; height: 14px;
    border-radius: 50%; background: white;
    transition: left 0.2s;
  }
  .toggle-btn.on  .toggle-knob { left: 20px; }
  .toggle-btn.off .toggle-knob { left: 2px; }

  /* ── One-Click Mode ── */
  .oc-mode { display: flex; flex-direction: column; gap: 10px; }
  .oc-price-row { display: flex; align-items: center; gap: 8px; }
  .oc-side {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    padding: 12px 8px;
    border-radius: 8px; border: 1px solid;
    gap: 2px;
  }
  .oc-side.yes { border-color: rgba(0,255,163,0.3); background: rgba(0,255,163,0.04); }
  .oc-side.no  { border-color: rgba(255,75,75,0.3);  background: rgba(255,75,75,0.04);  }
  .oc-divider { font-family: var(--mono); font-size: 10px; color: var(--text-dim); }
  .oc-outcome { font-family: var(--mono); font-size: 10px; font-weight: 700; }
  .oc-side.yes .oc-outcome { color: var(--bullish); }
  .oc-side.no  .oc-outcome { color: var(--bearish); }
  .oc-pct { font-family: var(--mono); font-size: 18px; font-weight: 700; }
  .oc-side.yes .oc-pct { color: var(--bullish); }
  .oc-side.no  .oc-pct { color: var(--bearish); }
  .oc-prob { font-family: var(--mono); font-size: 10px; color: var(--text-dim); }

  .oc-buttons { display: flex; gap: 8px; }
  .oc-btn {
    flex: 1; padding: 12px 8px;
    border: none; border-radius: 8px; cursor: pointer;
    font-family: var(--mono); font-weight: 700; font-size: 12px;
    letter-spacing: 0.08em;
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    transition: all 0.15s;
  }
  .oc-btn.yes { background: var(--bullish); color: var(--bg); }
  .oc-btn.no  { background: var(--bearish); color: white; }
  .oc-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
  .oc-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .oc-btn.loading { animation: pulse 1s infinite; }
  .oc-btn-sub { font-size: 10px; opacity: 0.7; }
  .oc-note { font-size: 11px; color: var(--text-dim); text-align: center; }

  /* ── Advanced Mode ── */
  .adv-mode { display: flex; flex-direction: column; gap: 10px; }
  .side-tabs, .outcome-tabs, .order-type-tabs {
    display: flex; border-radius: 7px; overflow: hidden;
    border: 1px solid var(--border2);
  }
  .side-tab, .outcome-tab, .ot-tab {
    flex: 1; padding: 7px; border: none; cursor: pointer;
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em;
    background: var(--surface2); color: var(--text-dim);
    transition: all 0.15s;
  }
  .side-tab.active-buy  { background: rgba(0,255,163,0.15); color: var(--bullish); }
  .side-tab.active-sell { background: rgba(255,75,75,0.15);  color: var(--bearish); }
  .outcome-tab.yes.active { background: rgba(0,255,163,0.15); color: var(--bullish); }
  .outcome-tab.no.active  { background: rgba(255,75,75,0.15);  color: var(--bearish); }
  .ot-tab.active { background: rgba(99,102,241,0.15); color: var(--accent); }
  .ot-price { margin-left: 5px; font-size: 11px; opacity: 0.8; }

  .input-group { display: flex; flex-direction: column; gap: 5px; }
  .input-label-row { display: flex; justify-content: space-between; align-items: center; }
  label { font-family: var(--mono); font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; }
  .input-balance { font-family: var(--mono); font-size: 9px; color: var(--text-dim); }
  .input-wrapper {
    display: flex; align-items: center;
    background: var(--surface2); border: 1px solid var(--border2);
    border-radius: 7px; overflow: hidden;
    transition: border-color 0.15s;
  }
  .input-wrapper:focus-within { border-color: var(--accent); }
  .input-prefix, .input-suffix {
    padding: 0 10px; font-family: var(--mono); font-size: 12px; color: var(--text-dim);
    background: var(--surface); height: 36px; display: grid; place-items: center;
    border-right: 1px solid var(--border2);
  }
  .input-suffix { border-right: none; border-left: 1px solid var(--border2); }
  .trade-input {
    flex: 1; height: 36px; background: none; border: none; outline: none;
    color: var(--text); font-family: var(--mono); font-size: 14px; font-weight: 700;
    padding: 0 10px;
  }
  .input-max {
    padding: 0 10px; background: none; border: none; cursor: pointer;
    font-family: var(--mono); font-size: 9px; color: var(--accent);
    letter-spacing: 0.1em; height: 36px;
    border-left: 1px solid var(--border2);
    transition: background 0.1s;
  }
  .input-max:hover { background: rgba(99,102,241,0.1); }

  .preset-amounts { display: flex; gap: 5px; margin-top: 5px; }
  .preset-btn {
    flex: 1; padding: 5px;
    background: var(--surface2); border: 1px solid var(--border2);
    border-radius: 5px; cursor: pointer;
    font-family: var(--mono); font-size: 10px; color: var(--text-sub);
    transition: all 0.1s;
  }
  .preset-btn:hover { border-color: var(--accent); color: var(--accent); }

  .trade-preview {
    background: rgba(99,102,241,0.05);
    border: 1px solid rgba(99,102,241,0.15);
    border-radius: 7px; padding: 10px 12px;
    display: flex; flex-direction: column; gap: 5px;
  }
  .preview-row {
    display: flex; justify-content: space-between;
    font-family: var(--mono); font-size: 11px; color: var(--text-sub);
  }
  .preview-row span:last-child { color: var(--text); }

  .slippage-row { display: flex; align-items: center; gap: 6px; }
  .slippage-row span { font-family: var(--mono); font-size: 9px; color: var(--text-dim); }
  .slippage-btn {
    padding: 3px 8px;
    background: none; border: 1px solid var(--border2);
    border-radius: 4px; cursor: pointer;
    font-family: var(--mono); font-size: 9px; color: var(--text-dim);
    transition: all 0.1s;
  }
  .slippage-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(99,102,241,0.1); }

  .trade-submit {
    width: 100%; padding: 13px;
    border: none; border-radius: 8px; cursor: pointer;
    font-family: var(--mono); font-size: 12px; font-weight: 700;
    letter-spacing: 0.1em; text-transform: uppercase;
    transition: all 0.15s;
  }
  .trade-submit.buy { background: var(--bullish); color: var(--bg); }
  .trade-submit.sell { background: var(--bearish); color: white; }
  .trade-submit:disabled { opacity: 0.4; cursor: not-allowed; }
  .trade-submit:not(:disabled):hover { filter: brightness(1.1); transform: translateY(-1px); }
  .trade-submit.submitting .spinner { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .connect-hint { font-size: 11px; color: var(--text-dim); text-align: center; }

  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
`;
