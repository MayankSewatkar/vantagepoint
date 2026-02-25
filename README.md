# ⚡ VantagePoint — The Truth Exchange

> A high-performance, decentralized prediction market where collective intelligence becomes tradable assets.

---

## Architecture

```
vantagepoint/
├── contracts/                   # Solidity smart contracts
│   ├── VantageMarket.sol        # Core: AMM + limit orders + oracle resolution
│   ├── hardhat.config.cjs       # Hardhat config (Base / Polygon)
│   └── deploy.cjs               # Deployment script
│
├── backend/                     # Python FastAPI metadata cache
│   ├── main.py                  # API server (markets, feed, leaderboard, SSE)
│   └── requirements.txt
│
└── frontend/                    # React + Vite frontend
    ├── src/
    │   ├── App.jsx              # Root: wallet providers, sidebar, routing
    │   ├── components/
    │   │   ├── TradingTerminal.jsx   # Chart + order book + trade panel
    │   │   └── MarketCard.jsx        # Discover grid card with sparkline
    │   └── hooks/
    │       └── useTrade.js      # All on-chain interactions via wagmi/viem
    ├── package.json
    └── vite.config.js
```

---

## Stack

| Layer      | Tech                                                    |
|------------|---------------------------------------------------------|
| Chain      | Base (primary) / Polygon (fallback)                     |
| Contracts  | Solidity 0.8.20, Hardhat, OpenZeppelin                  |
| Wallet     | wagmi v2 + viem + RainbowKit                            |
| Frontend   | React 18, Vite, Tailwind CSS                            |
| Data       | TanStack Query, The Graph subgraph, WebSocket SSE       |
| Charts     | TradingView Lightweight Charts                          |
| Backend    | FastAPI, Redis, httpx                                   |
| Oracle     | UMA / Chainlink (pluggable via `oracle` address)        |

---

## Quick Start

### 1. Smart Contracts

```bash
cd contracts
npm install
cp ../.env.example .env   # fill DEPLOYER_PRIVATE_KEY, RPC URLs

# Deploy to Base Sepolia testnet
npx hardhat run deploy.cjs --network base-sepolia
```

### 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Set env vars
export REDIS_URL="redis://localhost:6379"
export SUBGRAPH_URL="https://api.thegraph.com/subgraphs/name/yourname/vantagepoint"

python main.py  # starts on :8000
```

### 3. Frontend

```bash
cd frontend
npm install

cp .env.example .env
# Edit .env with your contract address and WalletConnect project ID

npm run dev     # starts on :5173
```

---

## Key Design Decisions

### AMM + Limit Orders (Hybrid)
- Constant product formula (`x * y = k`) provides always-available liquidity
- Limit orders sit in the contract and fill when AMM price crosses the limit
- Professional traders get price certainty; retail gets instant execution

### Truth Bond Dispute System
1. Oracle resolves → market enters 48h dispute window
2. Any user can post a **500 USDC Truth Bond** to challenge
3. UMA/Chainlink arbitrates → loser's bond is slashed
4. Removes centralized oracle risk without full decentralization cost

### Metadata Cache (FastAPI)
- Market questions, images, descriptions stored off-chain
- Redis caches subgraph responses (15s for prices, 5min for metadata)
- SSE `/prices/stream` endpoint pushes real-time updates to clients
- Keeps gas costs minimal while enabling rich UI data

### `useTrade` Hook
- Single source of truth for all blockchain interactions
- Handles USDC approval → trade → confirmation lifecycle
- Optimistic UI updates via TanStack Query cache invalidation
- Slippage protection built in (configurable, defaults 0.5%)

---

## One-Click Trade Mode

Toggle in the Trading Terminal header. When active:
- A single button press fires the trade immediately (no confirmation step)
- Uses the last configured amount and slippage settings
- Designed for high-frequency traders; disable for casual users

---

## Security Checklist

- [x] ReentrancyGuard on all state-changing functions
- [x] Slippage protection on all AMM trades
- [x] Dispute window before finalization (Truth Bond system)
- [x] Creator fee capped at 1% (100 bps)
- [x] Oracle address is owner-controlled (upgradeable to UMA/Chainlink)
- [ ] Formal audit recommended before mainnet launch
- [ ] Add multi-sig for `setOracle` and `withdrawProtocolFees`

---

## Roadmap

- [ ] Subgraph deployment (The Graph)
- [ ] UMA oracle integration
- [ ] Portfolio PnL tracking
- [ ] Multi-outcome markets (beyond binary)
- [ ] Cross-chain liquidity bridging
- [ ] Mobile app (React Native)
