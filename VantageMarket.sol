// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VantageMarket
 * @notice Prediction market using Constant Product AMM (x * y = k) + Limit Order support
 * @dev Binary Yes/No outcome tokens with Truth Bond dispute resolution
 */
contract VantageMarket is ReentrancyGuard, Ownable {

    // ─────────────────────────────────────────────
    // STRUCTS & ENUMS
    // ─────────────────────────────────────────────

    enum MarketStatus { OPEN, CLOSED, RESOLVING, DISPUTED, RESOLVED, VOIDED }
    enum Outcome      { UNRESOLVED, YES, NO }

    struct Market {
        uint256      id;
        string       question;
        string       category;
        string       imageURI;
        uint256      endTime;
        uint256      resolutionTime;
        uint256      disputeEndTime;
        MarketStatus status;
        Outcome      outcome;
        address      creator;
        address      yesToken;
        address      noToken;
        uint256      yesReserve;
        uint256      noReserve;
        uint256      k;
        uint256      totalLiquidity;
        uint256      volume24h;
        uint256      totalVolume;
        uint256      feeAccrued;
        bool         oracleSettled;
    }

    struct LimitOrder {
        uint256 orderId;
        uint256 marketId;
        address trader;
        bool    isBuyYes;
        uint256 price;        // basis points 0-10000
        uint256 amount;       // USDC
        bool    filled;
        bool    cancelled;
        uint256 createdAt;
    }

    struct TruthBond {
        address disputer;
        uint256 bondAmount;
        Outcome disputedOutcome;
        Outcome proposedOutcome;
        uint256 createdAt;
        bool    resolved;
    }

    struct Position {
        uint256 yesShares;
        uint256 noShares;
        uint256 avgYesCost;
        uint256 avgNoCost;
        uint256 realizedPnl;
    }

    // ─────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────

    IERC20  public immutable USDC;
    address public oracle;

    uint256 public nextMarketId = 1;
    uint256 public nextOrderId  = 1;
    uint256 public nextBondId   = 1;

    uint256 public constant FEE_BPS         = 100;
    uint256 public constant CREATOR_FEE_BPS = 25;
    uint256 public constant MIN_LIQUIDITY   = 1_000e6;
    uint256 public constant DISPUTE_BOND    = 500e6;
    uint256 public constant DISPUTE_WINDOW  = 24 hours;
    uint256 public constant INITIAL_SHARES  = 1_000_000e18;

    mapping(uint256 => Market)                        public markets;
    mapping(uint256 => LimitOrder)                    public limitOrders;
    mapping(uint256 => TruthBond)                     public truthBonds;
    mapping(uint256 => uint256)                       public marketDisputeId;
    mapping(uint256 => mapping(address => Position))  public positions;
    mapping(address => uint256[])                     public userMarkets;
    mapping(address => uint256[])                     public userOrders;

    uint256[] public activeMarketIds;

    // ─────────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────────

    event MarketCreated    (uint256 indexed marketId, address indexed creator, string question, string category);
    event TradeExecuted    (uint256 indexed marketId, address indexed trader, bool buyYes, uint256 usdcIn, uint256 sharesOut, uint256 newPrice);
    event LimitOrderPlaced (uint256 indexed orderId, uint256 indexed marketId, address indexed trader, bool isBuyYes, uint256 price, uint256 amount);
    event LimitOrderFilled (uint256 indexed orderId, uint256 indexed marketId);
    event LimitOrderCancelled(uint256 indexed orderId);
    event MarketResolved   (uint256 indexed marketId, Outcome outcome);
    event DisputeFiled     (uint256 indexed marketId, address indexed disputer, uint256 bondAmount);
    event DisputeResolved  (uint256 indexed marketId, bool disputeUpheld);
    event WinningsClaimed  (uint256 indexed marketId, address indexed user, uint256 amount);

    // ─────────────────────────────────────────────
    // ERRORS
    // ─────────────────────────────────────────────

    error MarketNotOpen();
    error MarketExpired();
    error SlippageExceeded();
    error NotOracle();
    error AlreadyResolved();
    error DisputeWindowActive();
    error DisputeWindowClosed();
    error DisputeAlreadyFiled();
    error NoWinnings();
    error OrderNotActive();
    error Unauthorized();
    error InvalidParams();

    // ─────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────

    constructor(address _usdc, address _oracle) Ownable(msg.sender) {
        USDC   = IERC20(_usdc);
        oracle = _oracle;
    }

    // ─────────────────────────────────────────────
    // CREATE MARKET
    // ─────────────────────────────────────────────

    function createMarket(
        string  calldata question,
        string  calldata category,
        string  calldata imageURI,
        uint256          endTime,
        uint256          resolutionTime,
        uint256          initialLiquidity
    ) external nonReentrant returns (uint256 marketId) {
        if (initialLiquidity < MIN_LIQUIDITY)        revert InvalidParams();
        if (endTime <= block.timestamp)              revert InvalidParams();
        if (resolutionTime <= endTime)               revert InvalidParams();

        USDC.transferFrom(msg.sender, address(this), initialLiquidity);

        marketId = nextMarketId++;

        OutcomeToken yesToken = new OutcomeToken(
            string.concat("VP-YES-", _itoa(marketId)),
            string.concat("YES",     _itoa(marketId))
        );
        OutcomeToken noToken = new OutcomeToken(
            string.concat("VP-NO-", _itoa(marketId)),
            string.concat("NO",     _itoa(marketId))
        );

        yesToken.mint(address(this), INITIAL_SHARES);
        noToken.mint (address(this), INITIAL_SHARES);

        markets[marketId] = Market({
            id:             marketId,
            question:       question,
            category:       category,
            imageURI:       imageURI,
            endTime:        endTime,
            resolutionTime: resolutionTime,
            disputeEndTime: resolutionTime + DISPUTE_WINDOW,
            status:         MarketStatus.OPEN,
            outcome:        Outcome.UNRESOLVED,
            creator:        msg.sender,
            yesToken:       address(yesToken),
            noToken:        address(noToken),
            yesReserve:     INITIAL_SHARES,
            noReserve:      INITIAL_SHARES,
            k:              INITIAL_SHARES * INITIAL_SHARES,
            totalLiquidity: initialLiquidity,
            volume24h:      0,
            totalVolume:    0,
            feeAccrued:     0,
            oracleSettled:  false
        });

        activeMarketIds.push(marketId);
        userMarkets[msg.sender].push(marketId);

        emit MarketCreated(marketId, msg.sender, question, category);
    }

    // ─────────────────────────────────────────────
    // AMM TRADING  x * y = k
    // ─────────────────────────────────────────────

    /**
     * @notice Buy YES or NO shares via AMM
     * @param buyYes      true = buy YES tokens
     * @param usdcIn      USDC to spend
     * @param minSharesOut slippage floor
     */
    function buyShares(
        uint256 marketId,
        bool    buyYes,
        uint256 usdcIn,
        uint256 minSharesOut
    ) external nonReentrant returns (uint256 sharesOut) {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.OPEN)       revert MarketNotOpen();
        if (block.timestamp >= m.endTime)         revert MarketExpired();

        USDC.transferFrom(msg.sender, address(this), usdcIn);

        uint256 fee        = (usdcIn * FEE_BPS)         / 10000;
        uint256 creatorFee = (usdcIn * CREATOR_FEE_BPS) / 10000;
        uint256 netIn      = usdcIn - fee - creatorFee;

        m.feeAccrued    += fee;
        m.totalVolume   += usdcIn;
        m.volume24h     += usdcIn;
        m.totalLiquidity += netIn;

        if (buyYes) {
            sharesOut     = (m.yesReserve * netIn) / (m.noReserve + netIn);
            if (sharesOut < minSharesOut) revert SlippageExceeded();
            m.yesReserve -= sharesOut;
            m.noReserve  += netIn;
            OutcomeToken(m.yesToken).mint(msg.sender, sharesOut);
        } else {
            sharesOut     = (m.noReserve * netIn) / (m.yesReserve + netIn);
            if (sharesOut < minSharesOut) revert SlippageExceeded();
            m.noReserve  -= sharesOut;
            m.yesReserve += netIn;
            OutcomeToken(m.noToken).mint(msg.sender, sharesOut);
        }
        m.k = m.yesReserve * m.noReserve;

        _updatePosition(marketId, msg.sender, buyYes, sharesOut, usdcIn);
        USDC.transfer(m.creator, creatorFee);

        emit TradeExecuted(marketId, msg.sender, buyYes, usdcIn, sharesOut, getCurrentPrice(marketId));
    }

    /**
     * @notice Sell YES or NO shares back to AMM
     */
    function sellShares(
        uint256 marketId,
        bool    sellYes,
        uint256 sharesIn,
        uint256 minUsdcOut
    ) external nonReentrant returns (uint256 usdcOut) {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.OPEN) revert MarketNotOpen();
        if (block.timestamp >= m.endTime)  revert MarketExpired();

        if (sellYes) {
            OutcomeToken(m.yesToken).burnFrom(msg.sender, sharesIn);
            usdcOut       = (m.noReserve  * sharesIn) / (m.yesReserve + sharesIn);
            m.yesReserve += sharesIn;
            m.noReserve  -= usdcOut;
        } else {
            OutcomeToken(m.noToken).burnFrom(msg.sender, sharesIn);
            usdcOut       = (m.yesReserve * sharesIn) / (m.noReserve + sharesIn);
            m.noReserve  += sharesIn;
            m.yesReserve -= usdcOut;
        }
        m.k = m.yesReserve * m.noReserve;

        uint256 fee = (usdcOut * FEE_BPS) / 10000;
        usdcOut    -= fee;
        m.feeAccrued += fee;
        m.totalVolume += usdcOut;

        if (usdcOut < minUsdcOut) revert SlippageExceeded();

        USDC.transfer(msg.sender, usdcOut);
        emit TradeExecuted(marketId, msg.sender, !sellYes, usdcOut, sharesIn, getCurrentPrice(marketId));
    }

    // ─────────────────────────────────────────────
    // LIMIT ORDERS
    // ─────────────────────────────────────────────

    function placeLimitOrder(
        uint256 marketId,
        bool    isBuyYes,
        uint256 priceBps,
        uint256 usdcAmount
    ) external nonReentrant returns (uint256 orderId) {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.OPEN) revert MarketNotOpen();
        if (block.timestamp >= m.endTime)  revert MarketExpired();
        if (priceBps > 10000)              revert InvalidParams();

        USDC.transferFrom(msg.sender, address(this), usdcAmount);

        orderId = nextOrderId++;
        limitOrders[orderId] = LimitOrder({
            orderId:   orderId,
            marketId:  marketId,
            trader:    msg.sender,
            isBuyYes:  isBuyYes,
            price:     priceBps,
            amount:    usdcAmount,
            filled:    false,
            cancelled: false,
            createdAt: block.timestamp
        });

        userOrders[msg.sender].push(orderId);
        emit LimitOrderPlaced(orderId, marketId, msg.sender, isBuyYes, priceBps, usdcAmount);
    }

    function cancelLimitOrder(uint256 orderId) external nonReentrant {
        LimitOrder storage o = limitOrders[orderId];
        if (o.trader != msg.sender)  revert Unauthorized();
        if (o.filled || o.cancelled) revert OrderNotActive();
        o.cancelled = true;
        USDC.transfer(msg.sender, o.amount);
        emit LimitOrderCancelled(orderId);
    }

    /// @notice Permissionless keeper fills limit orders at favorable price
    function fillLimitOrder(uint256 orderId) external nonReentrant {
        LimitOrder storage o = limitOrders[orderId];
        if (o.filled || o.cancelled) revert OrderNotActive();

        uint256 currentPrice = getCurrentPrice(o.marketId);
        bool canFill = o.isBuyYes
            ? currentPrice <= o.price
            : (10000 - currentPrice) <= o.price;
        require(canFill, "Price condition not met");

        o.filled = true;
        Market storage m = markets[o.marketId];
        uint256 fee    = (o.amount * FEE_BPS) / 10000;
        uint256 netIn  = o.amount - fee;

        m.feeAccrued    += fee;
        m.totalVolume   += o.amount;
        m.totalLiquidity += netIn;

        uint256 sharesOut;
        if (o.isBuyYes) {
            sharesOut     = (m.yesReserve * netIn) / (m.noReserve + netIn);
            m.yesReserve -= sharesOut;
            m.noReserve  += netIn;
            OutcomeToken(m.yesToken).mint(o.trader, sharesOut);
        } else {
            sharesOut     = (m.noReserve * netIn) / (m.yesReserve + netIn);
            m.noReserve  -= sharesOut;
            m.yesReserve += netIn;
            OutcomeToken(m.noToken).mint(o.trader, sharesOut);
        }
        m.k = m.yesReserve * m.noReserve;

        emit LimitOrderFilled(orderId, o.marketId);
        emit TradeExecuted(o.marketId, o.trader, o.isBuyYes, o.amount, sharesOut, getCurrentPrice(o.marketId));
    }

    // ─────────────────────────────────────────────
    // ORACLE RESOLUTION
    // ─────────────────────────────────────────────

    function submitOutcome(uint256 marketId, Outcome outcome) external {
        if (msg.sender != oracle)                         revert NotOracle();
        Market storage m = markets[marketId];
        if (m.status == MarketStatus.RESOLVED)           revert AlreadyResolved();
        require(block.timestamp >= m.resolutionTime,    "Too early");
        require(outcome != Outcome.UNRESOLVED,          "Invalid outcome");

        m.outcome       = outcome;
        m.status        = MarketStatus.RESOLVING;
        m.oracleSettled = true;
    }

    function finalizeMarket(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.RESOLVING,      "Not resolving");
        require(block.timestamp > m.disputeEndTime,      "Dispute window open");
        require(marketDisputeId[marketId] == 0,          "Dispute pending");

        m.status = MarketStatus.RESOLVED;
        emit MarketResolved(marketId, m.outcome);
    }

    // ─────────────────────────────────────────────
    // TRUTH BOND DISPUTE
    // ─────────────────────────────────────────────

    function fileDispute(uint256 marketId, Outcome proposedOutcome) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.RESOLVING,     "Not in resolving state");
        if (block.timestamp > m.disputeEndTime)         revert DisputeWindowClosed();
        if (marketDisputeId[marketId] != 0)             revert DisputeAlreadyFiled();
        require(proposedOutcome != m.outcome,           "Must dispute current outcome");

        USDC.transferFrom(msg.sender, address(this), DISPUTE_BOND);

        uint256 bondId = nextBondId++;
        truthBonds[bondId] = TruthBond({
            disputer:        msg.sender,
            bondAmount:      DISPUTE_BOND,
            disputedOutcome: m.outcome,
            proposedOutcome: proposedOutcome,
            createdAt:       block.timestamp,
            resolved:        false
        });

        marketDisputeId[marketId] = bondId;
        m.status = MarketStatus.DISPUTED;

        emit DisputeFiled(marketId, msg.sender, DISPUTE_BOND);
    }

    /// @notice DAO/multisig resolves dispute; production: integrate UMA OptimisticOracle
    function resolveDispute(uint256 marketId, bool disputeUpheld, Outcome finalOutcome)
        external onlyOwner
    {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.DISPUTED, "No active dispute");

        uint256 bondId = marketDisputeId[marketId];
        TruthBond storage bond = truthBonds[bondId];
        bond.resolved = true;

        if (disputeUpheld) {
            m.outcome = finalOutcome;
            // Return bond + 50% reward
            USDC.transfer(bond.disputer, bond.bondAmount + bond.bondAmount / 2);
        } else {
            USDC.transfer(owner(), bond.bondAmount);
        }

        m.status              = MarketStatus.RESOLVED;
        marketDisputeId[marketId] = 0;

        emit DisputeResolved(marketId, disputeUpheld);
        emit MarketResolved(marketId, m.outcome);
    }

    // ─────────────────────────────────────────────
    // CLAIM WINNINGS
    // ─────────────────────────────────────────────

    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.RESOLVED, "Not resolved");

        Position storage pos = positions[marketId][msg.sender];
        uint256 winShares;
        address winToken;

        if (m.outcome == Outcome.YES) {
            winShares     = pos.yesShares;
            winToken      = m.yesToken;
            pos.yesShares = 0;
        } else {
            winShares    = pos.noShares;
            winToken     = m.noToken;
            pos.noShares = 0;
        }

        if (winShares == 0) revert NoWinnings();

        uint256 totalSupply = OutcomeToken(winToken).totalSupply();
        OutcomeToken(winToken).burnFrom(msg.sender, winShares);

        uint256 payout = (m.totalLiquidity * winShares) / totalSupply;
        USDC.transfer(msg.sender, payout);

        emit WinningsClaimed(marketId, msg.sender, payout);
    }

    // ─────────────────────────────────────────────
    // VIEWS
    // ─────────────────────────────────────────────

    /// @notice P(YES) in basis points: noReserve / total * 10000
    function getCurrentPrice(uint256 marketId) public view returns (uint256) {
        Market storage m = markets[marketId];
        uint256 total = m.yesReserve + m.noReserve;
        if (total == 0) return 5000;
        return (m.noReserve * 10000) / total;
    }

    function getMarket(uint256 marketId)                               external view returns (Market memory)   { return markets[marketId]; }
    function getUserPosition(uint256 marketId, address user)           external view returns (Position memory) { return positions[marketId][user]; }
    function getActiveMarkets()                                        external view returns (uint256[] memory) { return activeMarketIds; }
    function getMarketCount()                                          external view returns (uint256)          { return nextMarketId - 1; }

    function previewBuy(uint256 marketId, bool buyYes, uint256 usdcIn)
        external view returns (uint256 sharesOut, uint256 priceImpactBps)
    {
        Market storage m = markets[marketId];
        uint256 netIn  = usdcIn - (usdcIn * (FEE_BPS + CREATOR_FEE_BPS) / 10000);
        uint256 pBefore = getCurrentPrice(marketId);

        uint256 newYes; uint256 newNo;
        if (buyYes) {
            sharesOut = (m.yesReserve * netIn) / (m.noReserve + netIn);
            newYes = m.yesReserve - sharesOut;
            newNo  = m.noReserve  + netIn;
        } else {
            sharesOut = (m.noReserve * netIn) / (m.yesReserve + netIn);
            newYes = m.yesReserve + netIn;
            newNo  = m.noReserve  - sharesOut;
        }

        uint256 pAfter = (newNo * 10000) / (newYes + newNo);
        priceImpactBps = pAfter > pBefore ? pAfter - pBefore : pBefore - pAfter;
    }

    // ─────────────────────────────────────────────
    // ADMIN
    // ─────────────────────────────────────────────

    function setOracle(address _oracle) external onlyOwner { oracle = _oracle; }

    function collectFees(uint256 marketId) external onlyOwner {
        uint256 fees = markets[marketId].feeAccrued;
        markets[marketId].feeAccrued = 0;
        USDC.transfer(owner(), fees);
    }

    // ─────────────────────────────────────────────
    // INTERNAL
    // ─────────────────────────────────────────────

    function _updatePosition(uint256 marketId, address user, bool buyYes, uint256 shares, uint256 cost) internal {
        Position storage pos = positions[marketId][user];
        if (buyYes) {
            uint256 totalCost = pos.yesShares * pos.avgYesCost + cost;
            pos.yesShares    += shares;
            pos.avgYesCost    = pos.yesShares > 0 ? totalCost / pos.yesShares : 0;
        } else {
            uint256 totalCost = pos.noShares * pos.avgNoCost + cost;
            pos.noShares     += shares;
            pos.avgNoCost     = pos.noShares > 0 ? totalCost / pos.noShares : 0;
        }
    }

    function _itoa(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v; uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory b = new bytes(len);
        uint256 k = len;
        while (v != 0) { k--; b[k] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OutcomeToken — ERC20 YES / NO shares
// ─────────────────────────────────────────────────────────────────────────────

contract OutcomeToken is ERC20 {
    address public immutable market;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        market = msg.sender;
    }

    modifier onlyMarket() {
        require(msg.sender == market, "Only market");
        _;
    }

    function mint    (address to,   uint256 amount) external onlyMarket { _mint (to,   amount); }
    function burnFrom(address from, uint256 amount) external onlyMarket { _burn (from, amount); }
}
