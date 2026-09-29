/**
 * Binance Trading/Transaction/Wallet client (Phase 6).
 *
 * Implements ONLY documented operations (Trading API, Transaction API,
 * Wallet API). Quote/swap RFQ+SWAP flows, ERC-20 approval preparation,
 * simulation, broadcast, on-chain status, RFQ order lifecycle, balances.
 * Normalizes everything into @olyr/types; never executes or signs anything
 * itself.
 */
import type {
  QuoteRoute,
  SimulationResult,
  SimulationStatus,
  SwapPreparation,
  UnsignedTransaction,
} from "@olyr/types";
import { HttpBinanceRwaClient } from "./rwa-client.js";
import type {
  RawBroadcast,
  RawQuoteRoute,
  RawRfqOrder,
  RawSimulation,
  RawSwapResponse,
  RawTokenBalance,
  RawTransactionStatus,
} from "./trading-raw.js";

export interface QuoteParams {
  chainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  /** Sell amount in the token's smallest unit (integer string). */
  amount: string;
  /** Required when quoting RFQ routes (equity/RWA tokens). */
  userWalletAddress?: string;
}

export interface SwapParams extends QuoteParams {
  quoteId: string;
  /** Slippage tolerance percent string; required unless autoSlippage. */
  slippagePercent?: string;
  autoSlippage?: boolean;
  /** Include spender/approve calldata in signatureData when approval is needed. */
  includeApproveTransaction?: boolean;
}

export interface TokenBalance {
  chainId: string;
  tokenContractAddress: string;
  address: string;
  symbol: string | null;
  balance: string | null;
  rawBalance: string | null;
  tokenPrice: string | null;
}

export interface BinanceTradingClient {
  /** GET /aggregator/quote — routes sorted by toTokenAmount descending. */
  getQuote(params: QuoteParams): Promise<QuoteRoute[]>;
  /** GET /aggregator/swap — build the swap or RFQ preparation from a quoteId. */
  buildSwap(params: SwapParams): Promise<SwapPreparation>;
  /** GET /aggregator/approve-transaction — ERC-20 approval transaction. */
  getApproveTransaction(params: {
    chainId: string;
    tokenContractAddress: string;
    approveAmount: string;
    /** RFQ vendor name — required for equity/RWA tokens. */
    vendor?: string;
  }): Promise<{ to: string; data: string; value: string }>;
  /** POST /pre-transaction/simulate — simulate an unsigned EVM transaction. */
  simulateTransaction(chainId: string, tx: UnsignedTransaction): Promise<SimulationResult>;
  /** POST /pre-transaction/broadcast-transaction — broadcast a SIGNED tx. */
  broadcastTransaction(
    chainId: string,
    signedTransaction: string,
    address: string,
  ): Promise<{ orderId: string; txHash: string }>;
  /** GET /aggregator/history — on-chain transaction status. */
  getTransactionStatus(
    chainId: string,
    txHash: string,
  ): Promise<{
    status: string;
    blockHeight: string | null;
    errorMsg: string | null;
    gasUsed: string | null;
    txFee: string | null;
    txTime: string | null;
  }>;
  /** POST /order/submit — submit a signed RFQ order (idempotent requestId). */
  submitRfqOrder(params: {
    requestId: string;
    userSignature: string;
    vendor: string;
    quoteId: string;
    signingScheme: string | null;
  }): Promise<RawRfqOrder>;
  /** GET /order/{orderId} — RFQ settlement status. */
  getRfqOrderStatus(orderId: string): Promise<RawRfqOrder>;
  /** GET /balance/all-token-balances-by-address — wallet balances. */
  getAllTokenBalances(chainId: string, address: string): Promise<TokenBalance[]>;
}

function normalizeQuoteRoute(raw: RawQuoteRoute): QuoteRoute {
  return {
    quoteId: raw.quoteId ?? null,
    vendorName: raw.vendorName ?? null,
    fromTokenAddress: raw.fromToken?.tokenContractAddress ?? "",
    toTokenAddress: raw.toToken?.tokenContractAddress ?? "",
    fromTokenAmount: raw.fromTokenAmount ?? null,
    toTokenAmount: raw.toTokenAmount ?? null,
    tradeFeeUsd: raw.tradeFee ?? null,
    estimateGasFee: raw.estimateGasFee ?? null,
    router: raw.router ?? null,
    priceImpactPercent: raw.priceImpactPercent ?? null,
    fromTokenUnitPrice: raw.fromToken?.tokenUnitPrice ?? null,
    toTokenUnitPrice: raw.toToken?.tokenUnitPrice ?? null,
    fromTokenSymbol: raw.fromToken?.tokenSymbol ?? null,
    toTokenSymbol: raw.toToken?.tokenSymbol ?? null,
  };
}

function normalizeSwapPreparation(raw: RawSwapResponse): SwapPreparation {
  const mode = raw.executionMode === "RFQ" ? "RFQ" : "SWAP";
  const routerResult = raw.routerResult;
  let tx: UnsignedTransaction | null = null;
  if (mode === "SWAP" && raw.tx) {
    tx = {
      chainId: routerResult?.binanceChainId ?? "",
      from: raw.tx.from,
      to: raw.tx.to,
      data: raw.tx.data,
      value: raw.tx.value,
      gas: raw.tx.gas ?? null,
      gasPrice: raw.tx.gasPrice ?? null,
      maxFeePerGas: null,
      maxPriorityFeePerGas: raw.tx.maxPriorityFeePerGas ?? null,
      nonce: null,
    };
  }
  return {
    mode,
    quoteId: raw.quoteId ?? null,
    tx,
    rfq:
      mode === "RFQ" && raw.rfq
        ? {
            vendor: raw.rfq.vendor,
            signingScheme: raw.rfq.signingScheme ?? null,
            typedDataToSign: raw.rfq.typedDataToSign,
          }
        : null,
    toTokenAmount: routerResult?.toTokenAmount ?? null,
    minReceiveAmount: raw.tx?.minReceiveAmount ?? null,
    slippagePercent: raw.tx?.slippagePercent ?? null,
    priceImpactPercent: routerResult?.priceImpactPercent ?? null,
    tradeFeeUsd: routerResult?.tradeFee ?? null,
    estimateGasFee: routerResult?.estimateGasFee ?? null,
  };
}

export class HttpBinanceTradingClient extends HttpBinanceRwaClient implements BinanceTradingClient {
  async getQuote(params: QuoteParams): Promise<QuoteRoute[]> {
    const { data } = await this.request<RawQuoteRoute[]>(
      "getQuote",
      "/api/v1/dex/aggregator/quote",
      {
        binanceChainId: params.chainId,
        fromTokenAddress: params.fromTokenAddress,
        toTokenAddress: params.toTokenAddress,
        amount: params.amount,
        userWalletAddress: params.userWalletAddress,
      },
    );
    return data.map(normalizeQuoteRoute);
  }

  async buildSwap(params: SwapParams): Promise<SwapPreparation> {
    const { data } = await this.request<RawSwapResponse>(
      "buildSwap",
      "/api/v1/dex/aggregator/swap",
      {
        binanceChainId: params.chainId,
        fromTokenAddress: params.fromTokenAddress,
        toTokenAddress: params.toTokenAddress,
        amount: params.amount,
        userWalletAddress: params.userWalletAddress,
        quoteId: params.quoteId,
        slippagePercent: params.slippagePercent,
        autoSlippage: params.autoSlippage ? "true" : undefined,
        approveTransaction: params.includeApproveTransaction ? "true" : undefined,
      },
    );
    return normalizeSwapPreparation(data);
  }

  async getApproveTransaction(params: {
    chainId: string;
    tokenContractAddress: string;
    approveAmount: string;
    vendor?: string;
  }): Promise<{ to: string; data: string; value: string }> {
    const { data } = await this.request<{ to: string; data: string; value: string }>(
      "getApproveTransaction",
      "/api/v1/dex/aggregator/approve-transaction",
      {
        binanceChainId: params.chainId,
        tokenContractAddress: params.tokenContractAddress,
        approveAmount: params.approveAmount,
        vendor: params.vendor,
      },
    );
    return data;
  }

  async simulateTransaction(chainId: string, tx: UnsignedTransaction): Promise<SimulationResult> {
    const { data, timestamp } = await this.request<RawSimulation>(
      "simulateTransaction",
      "/api/v1/dex/pre-transaction/simulate",
      {},
      {
        method: "POST",
        body: JSON.stringify({
          binanceChainId: chainId,
          evmTx: { from: tx.from, to: tx.to, value: tx.value, data: tx.data },
        }),
      },
    );
    const apiStatus = typeof data.status === "string" ? data.status : null;
    const status: SimulationStatus = apiStatus
      ? apiStatus.toUpperCase() === "SUCCESS" || apiStatus.toUpperCase() === "PASSED"
        ? "PASSED"
        : apiStatus.toUpperCase() === "FAILED"
          ? "FAILED"
          : "UNKNOWN"
      : "UNKNOWN";
    return {
      id: `sim_${timestamp}`,
      proposalId: null,
      quoteId: null,
      status,
      apiStatus,
      failReason: data.failReason ?? null,
      gasEstimate: null,
      balanceChanges: (data.balanceChanges ?? []).map((c) => ({
        contractAddress: c.contractAddress,
        tokenType: c.tokenType ?? null,
        change: c.change,
        owner: c.owner,
      })),
      allowanceChanges: (data.allowanceChanges ?? []).map((c) => ({
        tokenAddress: c.tokenAddress,
        owner: c.owner,
        spender: c.spender,
        preAmount: c.preAmount,
        postAmount: c.postAmount,
      })),
      warnings: [],
      timestamp: new Date(timestamp).toISOString(),
      source: "binance-web3",
    };
  }

  async broadcastTransaction(
    chainId: string,
    signedTransaction: string,
    address: string,
  ): Promise<{ orderId: string; txHash: string }> {
    const { data } = await this.request<RawBroadcast>(
      "broadcastTransaction",
      "/api/v1/dex/pre-transaction/broadcast-transaction",
      {},
      {
        method: "POST",
        body: JSON.stringify({
          binanceChainId: chainId,
          signedTransaction,
          address,
        }),
      },
    );
    return { orderId: data.orderId, txHash: data.txHash };
  }

  async getTransactionStatus(chainId: string, txHash: string) {
    const { data } = await this.request<RawTransactionStatus>(
      "getTransactionStatus",
      "/api/v1/dex/aggregator/history",
      { binanceChainId: chainId, txHash },
    );
    return {
      status: data.status,
      blockHeight: data.height ?? null,
      errorMsg: data.errorMsg ?? null,
      gasUsed: data.gasUsed ?? null,
      txFee: data.txFee ?? null,
      txTime: data.txTime ?? null,
    };
  }

  async submitRfqOrder(params: {
    requestId: string;
    userSignature: string;
    vendor: string;
    quoteId: string;
    signingScheme: string | null;
  }): Promise<RawRfqOrder> {
    const { data } = await this.request<RawRfqOrder>(
      "submitRfqOrder",
      "/api/v1/dex/aggregator/order/submit",
      {},
      {
        method: "POST",
        body: JSON.stringify({
          requestId: params.requestId,
          userSignature: params.userSignature,
          vendor: params.vendor,
          quoteId: params.quoteId,
          signingScheme: params.signingScheme ?? undefined,
        }),
      },
    );
    return data;
  }

  async getRfqOrderStatus(orderId: string): Promise<RawRfqOrder> {
    const { data } = await this.request<RawRfqOrder>(
      "getRfqOrderStatus",
      `/api/v1/dex/aggregator/order/${encodeURIComponent(orderId)}`,
      {},
    );
    return data;
  }

  async getAllTokenBalances(chainId: string, address: string): Promise<TokenBalance[]> {
    const { data } = await this.request<Array<{ tokenAssets: RawTokenBalance[] | null }>>(
      "getAllTokenBalances",
      "/api/v1/dex/balance/all-token-balances-by-address",
      {
        address,
        chains: chainId,
        excludeRiskToken: "false",
      },
    );
    return data.flatMap((entry) =>
      (entry.tokenAssets ?? [])
        .filter((t) => t.binanceChainId === chainId)
        .map((t) => ({
          chainId: t.binanceChainId,
          tokenContractAddress: t.tokenContractAddress,
          address: t.address,
          symbol: t.symbol ?? null,
          balance: t.balance ?? null,
          rawBalance: t.rawBalance ?? null,
          tokenPrice: t.tokenPrice ?? null,
        })),
    );
  }
}
