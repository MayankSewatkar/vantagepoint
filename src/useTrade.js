/**
 * useTrade — Custom hook for all on-chain trading interactions
 * Wraps wagmi/viem for wallet connectivity + contract calls
 */

import { useState, useCallback } from "react";
import {
  useAccount,
  usePublicClient,
  useWalletClient,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseUnits, formatUnits } from "viem";
import VANTAGE_MARKET_ABI from "../lib/VantageMarketABI.json";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS;

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

export function useTrade() {
  const { address, isConnected } = useAccount();
  const publicClient             = usePublicClient();
  const { data: walletClient }   = useWalletClient();
  const { writeContractAsync }   = useWriteContract();

  const [txHash,  setTxHash]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const { isLoading: isMining, isSuccess: isMined } =
    useWaitForTransactionReceipt({ hash: txHash });

  // ─── Approve USDC ─────────────────────────────────────────────────────────
  const approveUSDC = useCallback(async (amountUsdc) => {
    const amount = parseUnits(String(amountUsdc), 6);

    // Check existing allowance
    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address, CONTRACT_ADDRESS],
    });

    if (allowance >= amount) return true;   // Already approved

    const hash = await writeContractAsync({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACT_ADDRESS, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return true;
  }, [address, publicClient, writeContractAsync]);

  // ─── Preview buy (read-only, no gas) ──────────────────────────────────────
  const previewBuy = useCallback(async (marketId, buyYes, usdcAmount) => {
    const amountRaw = parseUnits(String(usdcAmount), 6);
    const [sharesOut, priceImpactBps] = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: VANTAGE_MARKET_ABI,
      functionName: "previewBuy",
      args: [BigInt(marketId), buyYes, amountRaw],
    });
    return {
      sharesOut:      formatUnits(sharesOut, 18),
      priceImpactBps: Number(priceImpactBps),
      priceImpactPct: Number(priceImpactBps) / 100,
    };
  }, [publicClient]);

  // ─── Buy shares (AMM) ─────────────────────────────────────────────────────
  const buyShares = useCallback(async ({
    marketId,
    buyYes,
    usdcAmount,
    slippageBps = 50,          // 0.5% default slippage tolerance
  }) => {
    if (!isConnected) throw new Error("Wallet not connected");
    setError(null);
    setLoading(true);

    try {
      const amountRaw = parseUnits(String(usdcAmount), 6);

      // 1. Preview to get min shares (slippage protection)
      const { sharesOut } = await previewBuy(marketId, buyYes, usdcAmount);
      const minShares = parseUnits(
        String(Number(sharesOut) * (1 - slippageBps / 10000)),
        18
      );

      // 2. Approve USDC
      await approveUSDC(usdcAmount);

      // 3. Execute trade
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: VANTAGE_MARKET_ABI,
        functionName: "buyShares",
        args: [BigInt(marketId), buyYes, amountRaw, minShares],
      });

      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    } catch (e) {
      setError(e.message || "Transaction failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [isConnected, approveUSDC, previewBuy, writeContractAsync, publicClient]);

  // ─── Sell shares ──────────────────────────────────────────────────────────
  const sellShares = useCallback(async ({
    marketId,
    sellYes,
    sharesAmount,
    slippageBps = 50,
  }) => {
    if (!isConnected) throw new Error("Wallet not connected");
    setError(null);
    setLoading(true);

    try {
      const sharesRaw = parseUnits(String(sharesAmount), 18);

      // Estimate USDC out
      const usdcOut = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: VANTAGE_MARKET_ABI,
        functionName: "sellShares",
        args: [BigInt(marketId), sellYes, sharesRaw, 0n],
        account: address,
      });

      const minUsdc = (usdcOut * BigInt(10000 - slippageBps)) / 10000n;

      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: VANTAGE_MARKET_ABI,
        functionName: "sellShares",
        args: [BigInt(marketId), sellYes, sharesRaw, minUsdc],
      });

      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    } catch (e) {
      setError(e.message || "Transaction failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [isConnected, address, publicClient, writeContractAsync]);

  // ─── One-Click Trade (preset amount, no slippage UI) ─────────────────────
  const oneClickTrade = useCallback(async ({ marketId, buyYes, presetUsdc = 100 }) => {
    return buyShares({ marketId, buyYes, usdcAmount: presetUsdc, slippageBps: 100 });
  }, [buyShares]);

  // ─── Place limit order ────────────────────────────────────────────────────
  const placeLimitOrder = useCallback(async ({ marketId, isBuyYes, priceBps, usdcAmount }) => {
    if (!isConnected) throw new Error("Wallet not connected");
    setError(null);
    setLoading(true);

    try {
      await approveUSDC(usdcAmount);
      const amountRaw = parseUnits(String(usdcAmount), 6);

      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: VANTAGE_MARKET_ABI,
        functionName: "placeLimitOrder",
        args: [BigInt(marketId), isBuyYes, BigInt(priceBps), amountRaw],
      });
      setTxHash(hash);
      return { hash };
    } catch (e) {
      setError(e.message || "Transaction failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [isConnected, approveUSDC, writeContractAsync]);

  // ─── Claim winnings ───────────────────────────────────────────────────────
  const claimWinnings = useCallback(async (marketId) => {
    if (!isConnected) throw new Error("Wallet not connected");
    const hash = await writeContractAsync({
      address: CONTRACT_ADDRESS,
      abi: VANTAGE_MARKET_ABI,
      functionName: "claimWinnings",
      args: [BigInt(marketId)],
    });
    setTxHash(hash);
    return { hash };
  }, [isConnected, writeContractAsync]);

  // ─── Read current price ───────────────────────────────────────────────────
  const { data: rawPrice, refetch: refetchPrice } = useReadContract({
    address:      CONTRACT_ADDRESS,
    abi:          VANTAGE_MARKET_ABI,
    functionName: "getCurrentPrice",
    args:         [1n],  // placeholder; override per market
  });

  return {
    // State
    loading,
    isMining,
    isMined,
    txHash,
    error,
    isConnected,
    address,

    // Actions
    buyShares,
    sellShares,
    oneClickTrade,
    placeLimitOrder,
    claimWinnings,
    approveUSDC,

    // Read
    previewBuy,
    refetchPrice,
  };
}
