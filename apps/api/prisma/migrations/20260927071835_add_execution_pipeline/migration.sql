-- CreateTable
CREATE TABLE "TradeQuote" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "fromTokenAddress" TEXT NOT NULL,
    "toTokenAddress" TEXT NOT NULL,
    "amountIn" TEXT NOT NULL,
    "estimatedAmountOut" TEXT,
    "routes" JSONB NOT NULL,
    "tradeFeeUsd" TEXT,
    "priceImpactPercent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "quoteId" TEXT,
    "status" TEXT NOT NULL,
    "apiStatus" TEXT,
    "failReason" TEXT,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionAuthorization" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "quoteId" TEXT,
    "simulationId" TEXT,
    "decision" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "policyMode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "quoteId" TEXT,
    "simulationId" TEXT,
    "authorizationId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'CREATED',
    "orderId" TEXT,
    "txHash" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'DRY_RUN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeQuote_proposalId_createdAt_idx" ON "TradeQuote"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "Simulation_proposalId_createdAt_idx" ON "Simulation"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionAuthorization_proposalId_createdAt_idx" ON "ExecutionAuthorization"("proposalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_idempotencyKey_key" ON "Execution"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "TradeQuote" ADD CONSTRAINT "TradeQuote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TradeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TradeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAuthorization" ADD CONSTRAINT "ExecutionAuthorization_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TradeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TradeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
