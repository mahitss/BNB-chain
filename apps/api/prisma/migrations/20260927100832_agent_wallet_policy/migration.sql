-- CreateTable
CREATE TABLE "AgentWallet" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'binance-agentic-wallet',
    "address" TEXT,
    "network" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "capabilities" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPolicy" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'MANUAL',
    "maxTradeUsd" DOUBLE PRECISION NOT NULL,
    "maxDailyUsd" DOUBLE PRECISION NOT NULL,
    "maxSlippagePercent" DOUBLE PRECISION NOT NULL,
    "allowedAssets" JSONB NOT NULL,
    "allowedActions" JSONB NOT NULL,
    "requireHumanApprovalAboveUsd" DOUBLE PRECISION NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPolicyVersion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "maxTradeUsd" DOUBLE PRECISION NOT NULL,
    "maxDailyUsd" DOUBLE PRECISION NOT NULL,
    "maxSlippagePercent" DOUBLE PRECISION NOT NULL,
    "allowedAssets" JSONB NOT NULL,
    "allowedActions" JSONB NOT NULL,
    "requireHumanApprovalAboveUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCapability" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "canReadMarketData" BOOLEAN NOT NULL DEFAULT true,
    "canReadWallet" BOOLEAN NOT NULL DEFAULT false,
    "canReadPortfolio" BOOLEAN NOT NULL DEFAULT false,
    "canRequestQuotes" BOOLEAN NOT NULL DEFAULT false,
    "canSimulateTransactions" BOOLEAN NOT NULL DEFAULT false,
    "canExecuteTrades" BOOLEAN NOT NULL DEFAULT false,
    "walletConfigured" BOOLEAN NOT NULL DEFAULT false,
    "policyMode" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCapability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentWallet_ownerId_key" ON "AgentWallet"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionPolicy_ownerId_key" ON "ExecutionPolicy"("ownerId");

-- CreateIndex
CREATE INDEX "ExecutionPolicy_ownerId_idx" ON "ExecutionPolicy"("ownerId");

-- AddForeignKey
ALTER TABLE "ExecutionPolicyVersion" ADD CONSTRAINT "ExecutionPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ExecutionPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
