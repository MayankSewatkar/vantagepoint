/**
 * VantagePoint — App.jsx
 * Main layout: sidebar nav, wallet state, routing shell
 */

import { useState, useEffect } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance } from "wagmi";
import MarketCard from "./components/MarketCard";
import TradingTerminal from "./components/TradingTerminal";
import Leaderboard from "./components/Leaderboard";
import ActivityFeed from "./components/ActivityFeed";

// ─── Mock data ───────────────────────────────────────────────────────────────
const MOCK_MARKETS = [
  { id: 1, question: "Will the Fed cut rates 50bps before June 2025?", category: "POLITICS",
    yesPriceBps: 6840, volume24h: 185000, totalVolume: 2450000, numTraders: 1247,
    imageUrl: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400",
    tags: ["fed", "rates", "macro"] },
  { id: 2, question: "Will Bitcoin exceed $150K before end of 2025?", category: "CRYPTO",
    yesPriceBps: 4230, volume24h: 720000, totalVolume: 8920000, numTraders: 5832,
    imageUrl: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400",
    tags: ["bitcoin", "crypto"] },
  { id: 3, question: "Will the Chiefs win Super Bowl LX?", category: "SPORTS",
    yesPriceBps: 3100, volume24h: 95000, totalVolume: 1230000, numTraders: 892,
    imageUrl: "https://images.unsplash.com/photo-1566577739112-5180d4bf9390?w=400",
    tags: ["nfl", "superbowl"] },
  { id: 4, question: "Will GPT-5 be released before Claude 4?", category: "CULTURE",
    yesPriceBps: 5500, volume24h: 48000, totalVolume: 680000, numTraders: 418,
    imageUrl: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=400",
    tags: ["ai", "openai"] },
  { id: 5, question: "Will Ethereum ETF staking be approved in 2025?", category: "CRYPTO",
    yesPriceBps: 7200, volume24h: 310000, totalVolume: 4100000, numTraders: 2891,
    imageUrl: "https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=400",
    tags: ["ethereum", "etf", "staking"] },
  { id: 6, question: "Will any US state pass UBI legislation in 2025?", category: "POLITICS",
    yesPriceBps: 1800, volume24h: 22000, totalVolume: 380000, numTraders: 231,
    imageUrl: "https://images.unsplash.com/photo-1589254065878-42c9da997008?w=400",
    tags: ["ubi", "policy"] },
];

const CATEGORIES = ["ALL", "POLITICS", "CRYPTO", "SPORTS", "CULTURE"];

const NAV_ITEMS = [
  { id: "discover",  label: "Discover",   icon: "◈" },
  { id: "portfolio", label: "Portfolio",  icon: "◎" },
  { id: "leaderboard", label: "Prophets", icon: "◆" },
  { id: "create",    label: "Create",     icon: "✦" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtVol(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

// ─── Components ──────────────────────────────────────────────────────────────

function Sidebar({ activeView, setActiveView, connected }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-mark">VP</span>
        <span className="logo-text">VANTAGE<em>POINT</em></span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activeView === item.id ? "active" : ""}`}
            onClick={() => setActiveView(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {activeView === item.id && <span className="nav-indicator" />}
          </button>
        ))}
      </nav>

      <div className="sidebar-stats">
        <div className="stat-row">
          <span className="stat-label">24H VOLUME</span>
          <span className="stat-value bullish">$24.8M</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">OPEN MARKETS</span>
          <span className="stat-value">95</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">TRADERS</span>
          <span className="stat-value">12.4K</span>
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="network-badge">
          <span className="pulse-dot" />
          BASE MAINNET
        </div>
      </div>
    </aside>
  );
}

function TopBar({ address, balance }) {
  return (
    <header className="topbar">
      <div className="topbar-search">
        <span className="search-icon">⌕</span>
        <input type="text" placeholder="Search markets, events, topics…" className="search-input" />
        <kbd className="search-kbd">⌘K</kbd>
      </div>
      <div className="topbar-right">
        {address && (
          <div className="balance-chip">
            <span className="balance-label">USDC</span>
            <span className="balance-value">{balance ? Number(balance.formatted).toFixed(2) : "—"}</span>
          </div>
        )}
        <ConnectButton
          accountStatus="avatar"
          showBalance={false}
          chainStatus="icon"
        />
      </div>
    </header>
  );
}

function DiscoverView({ markets, onSelectMarket, selectedMarket }) {
  const [category, setCategory] = useState("ALL");
  const [sortBy,   setSortBy]   = useState("volume_24h");
  const [view,     setView]     = useState("grid");

  const filtered = markets
    .filter(m => category === "ALL" || m.category === category)
    .sort((a, b) => {
      if (sortBy === "volume_24h") return b.volume24h - a.volume24h;
      if (sortBy === "probability") return Math.abs(b.yesPriceBps - 5000) - Math.abs(a.yesPriceBps - 5000);
      if (sortBy === "traders") return b.numTraders - a.numTraders;
      return b.totalVolume - a.totalVolume;
    });

  const hotMarkets = [...markets].sort((a, b) => b.volume24h - a.volume24h).slice(0, 3);

  return (
    <div className="discover-view">
      {/* Hot Markets Banner */}
      <section className="hot-section">
        <div className="section-header">
          <h2 className="section-title"><span className="fire">🔥</span> HOT MARKETS</h2>
          <span className="section-sub">by 24h volume</span>
        </div>
        <div className="hot-strip">
          {hotMarkets.map(m => (
            <div key={m.id} className="hot-chip" onClick={() => onSelectMarket(m)}>
              <span className="hot-chip-cat">{m.category}</span>
              <span className="hot-chip-q">{m.question.slice(0, 52)}…</span>
              <span className={`hot-chip-price ${m.yesPriceBps > 5000 ? "bullish" : "bearish"}`}>
                {(m.yesPriceBps / 100).toFixed(1)}%
              </span>
              <span className="hot-chip-vol">{fmtVol(m.volume24h)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Filters */}
      <div className="filter-bar">
        <div className="category-tabs">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`cat-tab ${category === cat ? "active" : ""}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="filter-controls">
          <select
            className="sort-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
          >
            <option value="volume_24h">Sort: 24H Volume</option>
            <option value="total_volume">Sort: Total Volume</option>
            <option value="traders">Sort: # Traders</option>
            <option value="probability">Sort: Extremity</option>
          </select>
          <div className="view-toggle">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>⊞</button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>☰</button>
          </div>
        </div>
      </div>

      {/* Market Grid */}
      <div className={`market-grid ${view}`}>
        {filtered.map(m => (
          <MarketCard
            key={m.id}
            market={m}
            selected={selectedMarket?.id === m.id}
            onSelect={() => onSelectMarket(m)}
          />
        ))}
      </div>
    </div>
  );
}

function PortfolioView({ address }) {
  if (!address) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◎</div>
        <h3>Connect your wallet</h3>
        <p>Connect your wallet to view your positions, PnL, and trading history.</p>
      </div>
    );
  }

  return (
    <div className="portfolio-view">
      <div className="portfolio-stats-bar">
        {[
          { label: "TOTAL VALUE", value: "$18,750", sub: "+12.4%", pos: true },
          { label: "REALIZED PNL", value: "+$4,200", sub: "all time", pos: true },
          { label: "UNREALIZED PNL", value: "+$940", sub: "open positions", pos: true },
          { label: "WIN RATE", value: "62%", sub: "34 markets", pos: null },
        ].map(s => (
          <div key={s.label} className="portfolio-stat">
            <span className="portfolio-stat-label">{s.label}</span>
            <span className={`portfolio-stat-value ${s.pos === true ? "bullish" : s.pos === false ? "bearish" : ""}`}>{s.value}</span>
            <span className="portfolio-stat-sub">{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="positions-table">
        <div className="table-header">
          <span>MARKET</span>
          <span>POSITION</span>
          <span>AVG PRICE</span>
          <span>CURRENT</span>
          <span>PNL</span>
          <span>ROI</span>
          <span>ACTION</span>
        </div>
        <div className="position-row">
          <span className="pos-question">Will the Fed cut rates 50bps before June 2025?</span>
          <span className="pos-side yes">YES ×10,000</span>
          <span className="pos-price">59.0¢</span>
          <span className="pos-current bullish">68.4¢</span>
          <span className="pos-pnl bullish">+$940</span>
          <span className="pos-roi bullish">+15.9%</span>
          <button className="pos-action">Trade</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { address, isConnected } = useAccount();
  const { data: balance }        = useBalance({ address, token: import.meta.env.VITE_USDC_ADDRESS });

  const [activeView,     setActiveView]     = useState("discover");
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [sidebarOpen,    setSidebarOpen]    = useState(true);

  // Select first market by default
  useEffect(() => {
    if (!selectedMarket) setSelectedMarket(MOCK_MARKETS[0]);
  }, []);

  const handleSelectMarket = (market) => {
    setSelectedMarket(market);
    setActiveView("terminal");
  };

  return (
    <div className="app-shell">
      <style>{CSS}</style>

      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        connected={isConnected}
      />

      <div className="main-content">
        <TopBar address={address} balance={balance} />

        <div className="content-area">
          {activeView === "discover" && (
            <DiscoverView
              markets={MOCK_MARKETS}
              onSelectMarket={handleSelectMarket}
              selectedMarket={selectedMarket}
            />
          )}
          {activeView === "terminal" && selectedMarket && (
            <TradingTerminal market={selectedMarket} />
          )}
          {activeView === "portfolio" && (
            <PortfolioView address={address} />
          )}
          {activeView === "leaderboard" && (
            <Leaderboard />
          )}
          {activeView === "create" && (
            <div className="coming-soon">
              <span>✦</span>
              <h3>Create a Market</h3>
              <p>Coming soon — deploy your own prediction market in one click.</p>
            </div>
          )}
        </div>

        {/* Live Activity Feed — right rail */}
        <ActivityFeed />
      </div>
    </div>
  );
}

// ─── CSS-in-JS (inlined for single-file simplicity) ──────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,700;1,400&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #0A0A0B;
    --surface:   #111114;
    --surface2:  #1A1A1F;
    --border:    #242429;
    --border2:   #2E2E35;
    --text:      #E8E8EF;
    --text-sub:  #7A7A8C;
    --text-dim:  #44444F;
    --bullish:   #00FFA3;
    --bearish:   #FF4B4B;
    --accent:    #6366F1;
    --gold:      #F59E0B;
    --mono:      'Space Mono', monospace;
    --sans:      'DM Sans', sans-serif;
  }

  html, body, #root { height: 100%; width: 100%; }
  body { background: var(--bg); color: var(--text); font-family: var(--sans); overflow: hidden; }

  /* ── App Shell ── */
  .app-shell {
    display: grid;
    grid-template-columns: 200px 1fr 280px;
    grid-template-rows: 100vh;
    height: 100vh;
    background: var(--bg);
    overflow: hidden;
  }

  /* ── Sidebar ── */
  .sidebar {
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }
  .sidebar-logo {
    padding: 20px 18px 18px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo-mark {
    width: 28px; height: 28px;
    background: var(--bullish);
    color: var(--bg);
    border-radius: 6px;
    display: grid; place-items: center;
    font-family: var(--mono);
    font-size: 11px; font-weight: 700;
    flex-shrink: 0;
  }
  .logo-text {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.12em;
    color: var(--text);
    font-weight: 700;
    text-transform: uppercase;
  }
  .logo-text em { color: var(--bullish); font-style: normal; }

  .sidebar-nav { padding: 12px 8px; flex: 1; }
  .nav-item {
    width: 100%; display: flex; align-items: center; gap: 10px;
    padding: 10px 12px;
    background: none; border: none; cursor: pointer;
    color: var(--text-sub);
    font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.08em; text-transform: uppercase;
    border-radius: 6px;
    position: relative; margin-bottom: 2px;
    transition: all 0.15s;
  }
  .nav-item:hover { background: var(--surface2); color: var(--text); }
  .nav-item.active { background: rgba(99,102,241,0.12); color: var(--bullish); }
  .nav-icon { width: 16px; text-align: center; font-size: 13px; }
  .nav-indicator {
    position: absolute; right: 0; top: 50%; transform: translateY(-50%);
    width: 2px; height: 16px; background: var(--bullish); border-radius: 1px;
  }

  .sidebar-stats {
    padding: 14px 16px;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .stat-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .stat-row:last-child { margin-bottom: 0; }
  .stat-label { font-family: var(--mono); font-size: 9px; color: var(--text-dim); letter-spacing: 0.1em; }
  .stat-value { font-family: var(--mono); font-size: 11px; color: var(--text); font-weight: 700; }
  .stat-value.bullish { color: var(--bullish); }

  .sidebar-footer { padding: 14px 16px; }
  .network-badge {
    display: flex; align-items: center; gap: 7px;
    font-family: var(--mono); font-size: 9px;
    color: var(--text-dim); letter-spacing: 0.1em;
  }
  .pulse-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--bullish);
    animation: pulse-glow 2s infinite;
  }
  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(0,255,163,0.4); }
    50%       { box-shadow: 0 0 0 4px rgba(0,255,163,0); }
  }

  /* ── Main Content ── */
  .main-content {
    display: flex; flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--border);
  }

  /* ── Top Bar ── */
  .topbar {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    height: 52px;
  }
  .topbar-search {
    flex: 1; display: flex; align-items: center; gap: 10px;
    background: var(--surface2); border: 1px solid var(--border2);
    border-radius: 8px; padding: 0 14px; height: 34px;
  }
  .search-icon { color: var(--text-dim); font-size: 16px; }
  .search-input {
    flex: 1; background: none; border: none; outline: none;
    color: var(--text); font-family: var(--sans); font-size: 13px;
  }
  .search-input::placeholder { color: var(--text-dim); }
  .search-kbd {
    background: var(--border2); border-radius: 4px;
    padding: 2px 6px; font-family: var(--mono); font-size: 10px;
    color: var(--text-dim);
  }
  .topbar-right { display: flex; align-items: center; gap: 10px; }
  .balance-chip {
    display: flex; align-items: center; gap: 6px;
    background: rgba(0,255,163,0.06); border: 1px solid rgba(0,255,163,0.2);
    border-radius: 6px; padding: 4px 10px;
  }
  .balance-label { font-family: var(--mono); font-size: 9px; color: var(--text-dim); letter-spacing: 0.1em; }
  .balance-value { font-family: var(--mono); font-size: 12px; color: var(--bullish); font-weight: 700; }

  /* ── Content Area ── */
  .content-area { flex: 1; overflow-y: auto; overflow-x: hidden; }
  .content-area::-webkit-scrollbar { width: 4px; }
  .content-area::-webkit-scrollbar-track { background: transparent; }
  .content-area::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  /* ── Hot Section ── */
  .hot-section { padding: 18px 20px 0; }
  .section-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .section-title { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text); }
  .section-sub { font-size: 11px; color: var(--text-dim); }
  .fire { font-size: 13px; }
  .hot-strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
  .hot-strip::-webkit-scrollbar { display: none; }
  .hot-chip {
    flex-shrink: 0; display: flex; align-items: center; gap: 10px;
    background: var(--surface2); border: 1px solid var(--border2);
    border-radius: 8px; padding: 10px 14px; cursor: pointer;
    transition: border-color 0.15s;
  }
  .hot-chip:hover { border-color: var(--bullish); }
  .hot-chip-cat { font-family: var(--mono); font-size: 9px; color: var(--accent); letter-spacing: 0.1em; }
  .hot-chip-q { font-size: 12px; color: var(--text); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hot-chip-price { font-family: var(--mono); font-size: 12px; font-weight: 700; }
  .hot-chip-vol { font-family: var(--mono); font-size: 10px; color: var(--text-dim); }

  /* ── Filter Bar ── */
  .filter-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px;
  }
  .category-tabs { display: flex; gap: 6px; }
  .cat-tab {
    padding: 5px 12px;
    background: none; border: 1px solid var(--border2);
    border-radius: 6px; cursor: pointer;
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em;
    color: var(--text-sub);
    transition: all 0.15s;
  }
  .cat-tab:hover { border-color: var(--text-sub); color: var(--text); }
  .cat-tab.active { background: rgba(99,102,241,0.15); border-color: var(--accent); color: var(--accent); }
  .filter-controls { display: flex; align-items: center; gap: 8px; }
  .sort-select {
    background: var(--surface2); border: 1px solid var(--border2);
    color: var(--text); border-radius: 6px; padding: 5px 10px;
    font-family: var(--mono); font-size: 10px; cursor: pointer;
    outline: none;
  }
  .view-toggle { display: flex; border: 1px solid var(--border2); border-radius: 6px; overflow: hidden; }
  .view-toggle button {
    background: none; border: none; cursor: pointer;
    color: var(--text-dim); padding: 5px 10px; font-size: 13px;
    transition: all 0.15s;
  }
  .view-toggle button.active { background: var(--surface2); color: var(--text); }

  /* ── Market Grid ── */
  .market-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
    padding: 0 20px 20px;
  }
  .market-grid.list {
    grid-template-columns: 1fr;
  }

  /* ── Portfolio ── */
  .portfolio-view { padding: 20px; }
  .portfolio-stats-bar {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 12px; margin-bottom: 24px;
  }
  .portfolio-stat {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px 16px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .portfolio-stat-label { font-family: var(--mono); font-size: 9px; color: var(--text-dim); letter-spacing: 0.1em; }
  .portfolio-stat-value { font-family: var(--mono); font-size: 18px; font-weight: 700; }
  .portfolio-stat-sub { font-size: 11px; color: var(--text-sub); }
  .positions-table { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .table-header {
    display: grid; grid-template-columns: 3fr 1.5fr 1fr 1fr 1fr 1fr 1fr;
    padding: 10px 16px;
    font-family: var(--mono); font-size: 9px; color: var(--text-dim); letter-spacing: 0.1em;
    border-bottom: 1px solid var(--border);
  }
  .position-row {
    display: grid; grid-template-columns: 3fr 1.5fr 1fr 1fr 1fr 1fr 1fr;
    padding: 14px 16px; align-items: center;
    border-bottom: 1px solid var(--border); font-size: 13px;
  }
  .pos-question { color: var(--text); font-size: 12px; }
  .pos-side.yes { color: var(--bullish); font-family: var(--mono); font-size: 11px; font-weight: 700; }
  .pos-side.no  { color: var(--bearish); font-family: var(--mono); font-size: 11px; font-weight: 700; }
  .pos-price, .pos-current { font-family: var(--mono); font-size: 12px; }
  .pos-pnl, .pos-roi { font-family: var(--mono); font-size: 12px; font-weight: 700; }
  .pos-action {
    background: rgba(99,102,241,0.15); border: 1px solid var(--accent);
    color: var(--accent); border-radius: 5px; padding: 5px 10px;
    font-family: var(--mono); font-size: 10px; cursor: pointer;
    transition: all 0.15s;
  }
  .pos-action:hover { background: var(--accent); color: white; }

  /* ── Utilities ── */
  .bullish { color: var(--bullish) !important; }
  .bearish { color: var(--bearish) !important; }

  .empty-state, .coming-soon {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 60vh; gap: 12px; color: var(--text-sub); text-align: center;
  }
  .empty-icon { font-size: 48px; opacity: 0.3; margin-bottom: 8px; }
  .empty-state h3, .coming-soon h3 { color: var(--text); font-size: 18px; }
  .empty-state p, .coming-soon p { font-size: 14px; color: var(--text-sub); max-width: 300px; }
  .coming-soon span { font-size: 40px; color: var(--bullish); margin-bottom: 8px; }
`;
