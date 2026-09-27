/** Raw Trading/Transaction/Wallet API payload shapes (documented only). */

export interface RawQuoteRoute {
  quoteId: string | null;
  vendorName: string | null;
  fromTokenAmount: string | null;
  toTokenAmount: string | null;
  tradeFee: string | null;
  estimateGasFee: string | null;
  router: string | null;
  priceImpactPercent: string | null;
  dexRouterList: Array<{
    dexProtocol: { dexName: string } | null;
    fromToken: { tokenContractAddress: string; tokenSymbol: string } | null;
    toToken: { tokenContractAddress: string; tokenSymbol: string } | null;
  }> | null;
  fromToken: {
    tokenContractAddress: string;
    tokenSymbol: string | null;
    tokenUnitPrice: string | null;
    decimal: string | null;
  } | null;
  toToken: {
    tokenContractAddress: string;
    tokenSymbol: string | null;
    tokenUnitPrice: string | null;
    decimal: string | null;
  } | null;
}

export interface RawSwapResponse {
  routerResult: {
    binanceChainId: string;
    vendorName: string;
    fromTokenAmount: string;
    toTokenAmount: string;
    tradeFee: string | null;
    estimateGasFee: string | null;
    router: string | null;
    priceImpactPercent: string | null;
  } | null;
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    gas: string | null;
    gasPrice: string | null;
    maxPriorityFeePerGas: string | null;
    minReceiveAmount: string | null;
    slippagePercent: string | null;
  } | null;
  executionMode: string; // "SWAP" | "RFQ"
  quoteId: string | null;
  rfq: {
    vendor: string;
    txType: string;
    typedDataToSign: string;
    signingScheme: string | null;
  } | null;
}

export interface RawSimulation {
  status: string; // predicted execution status
  failReason: string | null;
  balanceChanges: Array<{
    contractAddress: string;
    tokenType: string | null;
    change: string;
    owner: string;
  }> | null;
  allowanceChanges: Array<{
    tokenAddress: string;
    owner: string;
    spender: string;
    preAmount: string;
    postAmount: string;
  }> | null;
}

export interface RawBroadcast {
  orderId: string;
  txHash: string;
}

export interface RawTransactionStatus {
  binanceChainId: string;
  txHash: string;
  height: string | null;
  txTime: string | null;
  status: string;
  errorMsg: string | null;
  gasUsed: string | null;
  gasPrice: string | null;
  txFee: string | null;
}

export interface RawRfqOrder {
  orderId: string;
  status: string; // PENDING_VENDOR | FILLED | FAILED | EXPIRED | CANCELLED
}

export interface RawTokenBalance {
  binanceChainId: string;
  tokenContractAddress: string;
  address: string;
  symbol: string | null;
  balance: string | null;
  rawBalance: string | null;
  tokenPrice: string | null;
  isRiskToken: boolean | null;
}
