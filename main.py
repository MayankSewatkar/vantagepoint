"""
VantagePoint — FastAPI Metadata Cache
Serves market metadata (descriptions, images, categories) without hitting
the chain on every request. Backed by Redis + Postgres in production.
"""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from functools import lru_cache
import json
import os

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

CHAIN_RPC_URL      = os.getenv("CHAIN_RPC_URL",      "https://mainnet.base.org")
CONTRACT_ADDRESS   = os.getenv("CONTRACT_ADDRESS",   "0xYourContractAddress")
SUBGRAPH_URL       = os.getenv("SUBGRAPH_URL",        "https://api.thegraph.com/subgraphs/name/vantagepoint/markets")
IPFS_GATEWAY       = os.getenv("IPFS_GATEWAY",        "https://cloudflare-ipfs.com/ipfs/")
REDIS_URL          = os.getenv("REDIS_URL",           "redis://localhost:6379")
CACHE_TTL_SECONDS  = int(os.getenv("CACHE_TTL",       "60"))

# ─────────────────────────────────────────────────────────────────────────────
# In-memory cache (replace with Redis in production)
# ─────────────────────────────────────────────────────────────────────────────

_cache: dict[str, tuple[float, object]] = {}

def cache_get(key: str):
    if key in _cache:
        ts, val = _cache[key]
        if time.time() - ts < CACHE_TTL_SECONDS:
            return val
    return None

def cache_set(key: str, val: object):
    _cache[key] = (time.time(), val)


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────────────────────────────────────

class MarketMeta(BaseModel):
    """Off-chain metadata for a prediction market"""
    market_id:        int
    question:         str
    description:      str
    category:         str   # POLITICS | CRYPTO | SPORTS | CULTURE
    image_url:        str
    tags:             list[str] = []
    source_url:       Optional[str] = None
    creator_note:     Optional[str] = None
    resolution_rules: str          = ""

class MarketStats(BaseModel):
    """On-chain stats cached off-chain for fast serving"""
    market_id:        int
    yes_price_bps:    int    = Field(..., description="YES probability in bps 0-10000")
    no_price_bps:     int
    total_volume_usd: float
    volume_24h_usd:   float
    total_liquidity:  float
    num_traders:      int
    yes_reserve:      str
    no_reserve:       str
    last_updated:     float

class Trade(BaseModel):
    market_id:   int
    trader:      str
    is_buy_yes:  bool
    usdc_in:     float
    shares_out:  float
    price_bps:   int
    tx_hash:     str
    timestamp:   float

class LeaderboardEntry(BaseModel):
    rank:          int
    address:       str
    display_name:  Optional[str]
    avatar_url:    Optional[str]
    total_pnl:     float
    roi_pct:       float
    accuracy_rate: float   # % of resolved markets called correctly
    belief_score:  int     # reputation score
    num_positions: int

class CreateMarketRequest(BaseModel):
    question:         str
    description:      str
    category:         str
    image_ipfs_hash:  Optional[str] = None
    image_url:        Optional[str] = None
    tags:             list[str] = []
    source_url:       Optional[str] = None
    resolution_rules: str

class MarketSearchResult(BaseModel):
    markets:     list[dict]
    total_count: int
    page:        int
    page_size:   int

# ─────────────────────────────────────────────────────────────────────────────
# Mock data for development (replace with DB queries in production)
# ─────────────────────────────────────────────────────────────────────────────

MOCK_MARKETS: list[dict] = [
    {
        "market_id": 1,
        "question": "Will the Fed cut rates by 50bps before June 2025?",
        "description": "Resolves YES if the Federal Reserve announces a 50 basis point or greater rate cut before June 30, 2025. Resolution source: Fed official press releases.",
        "category": "POLITICS",
        "image_url": "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400",
        "tags": ["fed", "rates", "macro", "finance"],
        "source_url": "https://federalreserve.gov",
        "resolution_rules": "Resolves YES if FOMC minutes confirm ≥50bps cut before June 30 2025.",
        "yes_price_bps": 6840,
        "no_price_bps":  3160,
        "total_volume_usd": 2_450_000.0,
        "volume_24h_usd":   185_000.0,
        "total_liquidity":  890_000.0,
        "num_traders": 1247,
    },
    {
        "market_id": 2,
        "question": "Will Bitcoin exceed $150K before end of 2025?",
        "description": "Resolves YES if BTC/USD spot price on Coinbase Pro crosses $150,000 at any point before Dec 31, 2025 23:59 UTC.",
        "category": "CRYPTO",
        "image_url": "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400",
        "tags": ["bitcoin", "btc", "crypto", "price"],
        "source_url": "https://coinbase.com",
        "resolution_rules": "Resolves YES if BTC/USD on Coinbase Pro >= $150,000 before EOY 2025.",
        "yes_price_bps": 4230,
        "no_price_bps":  5770,
        "total_volume_usd": 8_920_000.0,
        "volume_24h_usd":   720_000.0,
        "total_liquidity":  3_100_000.0,
        "num_traders": 5832,
    },
    {
        "market_id": 3,
        "question": "Will the Kansas City Chiefs win Super Bowl LX?",
        "description": "Resolves YES if the Kansas City Chiefs win Super Bowl LX (Feb 2026). Resolution: official NFL result.",
        "category": "SPORTS",
        "image_url": "https://images.unsplash.com/photo-1566577739112-5180d4bf9390?w=400",
        "tags": ["nfl", "superbowl", "chiefs", "sports"],
        "source_url": "https://nfl.com",
        "resolution_rules": "Resolves YES if KC Chiefs are Super Bowl LX champions.",
        "yes_price_bps": 3100,
        "no_price_bps":  6900,
        "total_volume_usd": 1_230_000.0,
        "volume_24h_usd":   95_000.0,
        "total_liquidity":  450_000.0,
        "num_traders": 892,
    },
    {
        "market_id": 4,
        "question": "Will GPT-5 be released before Claude 4?",
        "description": "Resolves YES if OpenAI officially releases GPT-5 to the public before Anthropic releases Claude 4 (successor to Claude 3). Based on official announcements.",
        "category": "CULTURE",
        "image_url": "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=400",
        "tags": ["ai", "openai", "anthropic", "llm"],
        "source_url": "https://openai.com",
        "resolution_rules": "Resolves YES if GPT-5 public release precedes Claude 4 public release.",
        "yes_price_bps": 5500,
        "no_price_bps":  4500,
        "total_volume_usd": 680_000.0,
        "volume_24h_usd":   48_000.0,
        "total_liquidity":  220_000.0,
        "num_traders": 418,
    },
]

MOCK_LEADERBOARD: list[dict] = [
    {"rank": 1, "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "display_name": "0xVitalik", "avatar_url": None, "total_pnl": 428_500.0, "roi_pct": 312.4, "accuracy_rate": 0.74, "belief_score": 9820, "num_positions": 156},
    {"rank": 2, "address": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", "display_name": "PredictorX", "avatar_url": None, "total_pnl": 287_200.0, "roi_pct": 241.1, "accuracy_rate": 0.71, "belief_score": 8455, "num_positions": 203},
    {"rank": 3, "address": "0x1234567890AbcdEF1234567890aBcdef12345678", "display_name": "WhaleSeer",  "avatar_url": None, "total_pnl": 194_100.0, "roi_pct": 188.7, "accuracy_rate": 0.68, "belief_score": 7210, "num_positions": 89},
]

# ─────────────────────────────────────────────────────────────────────────────
# Lifespan
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 VantagePoint API starting up")
    yield
    print("🛑 VantagePoint API shutting down")

# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "VantagePoint Metadata API",
    description = "Off-chain metadata cache and aggregation layer for the VantagePoint prediction market",
    version     = "1.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Routes: Markets
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": time.time(), "version": "1.0.0"}


@app.get("/markets", response_model=MarketSearchResult)
async def list_markets(
    category:  Optional[str] = Query(None, description="Filter by POLITICS | CRYPTO | SPORTS | CULTURE"),
    sort_by:   str            = Query("volume_24h", description="volume_24h | total_volume | num_traders | yes_price"),
    page:      int            = Query(1,  ge=1),
    page_size: int            = Query(20, ge=1, le=100),
    search:    Optional[str]  = Query(None, description="Full-text search on question/tags"),
):
    """List all markets with optional filtering and sorting"""
    cache_key = f"markets:{category}:{sort_by}:{page}:{page_size}:{search}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    markets = list(MOCK_MARKETS)  # In prod: DB query

    # Filter
    if category:
        markets = [m for m in markets if m["category"].upper() == category.upper()]
    if search:
        q = search.lower()
        markets = [m for m in markets if q in m["question"].lower() or q in str(m.get("tags", "")).lower()]

    # Sort
    sort_map = {
        "volume_24h":   lambda m: m.get("volume_24h_usd", 0),
        "total_volume": lambda m: m.get("total_volume_usd", 0),
        "num_traders":  lambda m: m.get("num_traders", 0),
        "yes_price":    lambda m: m.get("yes_price_bps", 5000),
    }
    markets.sort(key=sort_map.get(sort_by, sort_map["volume_24h"]), reverse=True)

    # Paginate
    total    = len(markets)
    start    = (page - 1) * page_size
    end      = start + page_size
    paged    = markets[start:end]

    result = MarketSearchResult(markets=paged, total_count=total, page=page, page_size=page_size)
    cache_set(cache_key, result)
    return result


@app.get("/markets/hot", response_model=list[dict])
async def hot_markets(limit: int = Query(5, ge=1, le=20)):
    """Top markets by 24h volume × volatility score"""
    cached = cache_get(f"hot:{limit}")
    if cached:
        return cached

    scored = sorted(
        MOCK_MARKETS,
        key=lambda m: m["volume_24h_usd"] * abs(m["yes_price_bps"] - 5000) / 5000,
        reverse=True
    )
    result = scored[:limit]
    cache_set(f"hot:{limit}", result)
    return result


@app.get("/markets/{market_id}", response_model=dict)
async def get_market(market_id: int):
    """Get full metadata + stats for a single market"""
    cached = cache_get(f"market:{market_id}")
    if cached:
        return cached

    market = next((m for m in MOCK_MARKETS if m["market_id"] == market_id), None)
    if not market:
        raise HTTPException(status_code=404, detail=f"Market {market_id} not found")

    cache_set(f"market:{market_id}", market)
    return market


@app.get("/markets/{market_id}/trades", response_model=list[dict])
async def get_market_trades(
    market_id: int,
    limit:     int = Query(50, ge=1, le=500),
    before_ts: Optional[float] = None,
):
    """Recent trades for a market (served from Subgraph cache)"""
    # In production: query The Graph subgraph
    mock_trades = [
        {
            "market_id":  market_id,
            "trader":     "0xabc123...",
            "is_buy_yes": True,
            "usdc_in":    5000.0,
            "shares_out": 7320.5,
            "price_bps":  6840,
            "tx_hash":    f"0x{'a' * 64}",
            "timestamp":  time.time() - i * 30,
        }
        for i in range(min(limit, 20))
    ]
    return mock_trades


@app.get("/markets/{market_id}/price-history")
async def get_price_history(
    market_id: int,
    interval:  str = Query("1h", description="1m | 5m | 15m | 1h | 4h | 1d"),
    limit:     int = Query(200, ge=1, le=1000),
):
    """OHLCV candlestick data for TradingView Lightweight Charts"""
    now    = int(time.time())
    intervals = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
    step   = intervals.get(interval, 3600)

    import random
    random.seed(market_id)
    price  = 5000
    candles = []
    for i in range(limit, 0, -1):
        t     = now - i * step
        delta = random.randint(-200, 200)
        open_ = price
        close = max(100, min(9900, price + delta))
        high  = max(open_, close) + random.randint(0, 100)
        low   = min(open_, close) - random.randint(0, 100)
        vol   = random.uniform(10_000, 200_000)
        candles.append({"time": t, "open": open_, "high": high, "low": low, "close": close, "volume": vol})
        price = close

    return {"market_id": market_id, "interval": interval, "candles": candles}


@app.post("/markets", status_code=201)
async def create_market_metadata(req: CreateMarketRequest, background_tasks: BackgroundTasks):
    """
    Store off-chain metadata BEFORE the creator sends the on-chain tx.
    Returns a metadata_id to include in the on-chain imageURI field (as IPFS hash prefix).
    """
    metadata_id = f"vp-{int(time.time())}"
    image_url   = req.image_url or f"{IPFS_GATEWAY}{req.image_ipfs_hash}" if req.image_ipfs_hash else ""

    new_meta = {
        "metadata_id":      metadata_id,
        "question":         req.question,
        "description":      req.description,
        "category":         req.category,
        "image_url":        image_url,
        "tags":             req.tags,
        "source_url":       req.source_url,
        "resolution_rules": req.resolution_rules,
        "created_at":       time.time(),
    }

    # In production: save to Postgres + IPFS pin
    cache_set(f"pending_meta:{metadata_id}", new_meta)

    return {"metadata_id": metadata_id, "ipfs_uri": f"ipfs://{metadata_id}"}


# ─────────────────────────────────────────────────────────────────────────────
# Routes: Leaderboard & Users
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/leaderboard", response_model=list[LeaderboardEntry])
async def get_leaderboard(
    metric:  str = Query("total_pnl", description="total_pnl | roi_pct | accuracy_rate | belief_score"),
    limit:   int = Query(50, ge=1, le=200),
    timeframe: str = Query("alltime", description="7d | 30d | alltime"),
):
    """Top Prophets leaderboard"""
    return [LeaderboardEntry(**e) for e in MOCK_LEADERBOARD[:limit]]


@app.get("/users/{address}/profile")
async def get_user_profile(address: str):
    """User profile: accuracy rate, belief score, PnL history"""
    # In production: aggregate from on-chain events via The Graph
    return {
        "address":       address,
        "display_name":  None,
        "belief_score":  4250,
        "accuracy_rate": 0.62,
        "total_pnl":     18_750.0,
        "roi_pct":       87.4,
        "num_positions": 34,
        "win_rate":      0.62,
        "joined_at":     1_700_000_000,
        "badges":        ["early_adopter", "whale"],
    }


@app.get("/users/{address}/positions")
async def get_user_positions(address: str, status: str = Query("open", description="open | closed | all")):
    """User's open/closed positions with PnL"""
    return {
        "address":  address,
        "status":   status,
        "positions": [
            {
                "market_id":   1,
                "question":    "Will the Fed cut rates by 50bps before June 2025?",
                "yes_shares":  10_000.0,
                "no_shares":   0.0,
                "avg_cost_bps": 5900,
                "current_price_bps": 6840,
                "unrealized_pnl": 940.0,
                "realized_pnl": 0.0,
                "roi_pct": 15.9,
            }
        ]
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes: Activity Feed (Whale Watcher)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/feed/activity")
async def get_activity_feed(limit: int = Query(20, ge=1, le=100)):
    """
    Live ticker of big bets / whale movements.
    In production: consume from WebSocket stream / chain event log.
    """
    now = time.time()
    return [
        {
            "type":       "WHALE_TRADE",
            "market_id":  m["market_id"],
            "question":   m["question"][:60] + "…",
            "trader":     "0x" + "a" * 4 + "…" + "b" * 4,
            "direction":  "YES" if i % 2 == 0 else "NO",
            "usdc_amount": round(10_000 + i * 7_500, 2),
            "price_bps":  m["yes_price_bps"],
            "timestamp":  now - i * 45,
        }
        for i, m in enumerate(MOCK_MARKETS * 3)
    ][:limit]


# ─────────────────────────────────────────────────────────────────────────────
# Routes: Oracle / Resolution
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/markets/{market_id}/resolution-status")
async def get_resolution_status(market_id: int):
    return {
        "market_id":         market_id,
        "oracle_status":     "PENDING",
        "dispute_active":    False,
        "dispute_end_time":  None,
        "proposed_outcome":  None,
        "truth_bond_amount": 500,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes: Search & Discovery
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/search")
async def search(q: str = Query(..., min_length=2)):
    results = [
        m for m in MOCK_MARKETS
        if q.lower() in m["question"].lower()
        or q.lower() in str(m.get("tags", [])).lower()
    ]
    return {"query": q, "results": results, "count": len(results)}


@app.get("/categories")
async def get_categories():
    return [
        {"id": "POLITICS", "label": "Politics",  "icon": "🏛️", "market_count": 24, "total_volume": 12_500_000},
        {"id": "CRYPTO",   "label": "Crypto",    "icon": "₿",  "market_count": 41, "total_volume": 48_200_000},
        {"id": "SPORTS",   "label": "Sports",    "icon": "🏆",  "market_count": 18, "total_volume":  8_900_000},
        {"id": "CULTURE",  "label": "Culture",   "icon": "🎭",  "market_count": 12, "total_volume":  3_100_000},
    ]

