-- CreateTable
CREATE TABLE "TradeProposal" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT,
    "asset" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestedAmountUsd" DOUBLE PRECISION NOT NULL,
    "estimatedPrice" DOUBLE PRECISION,
    "referencePrice" DOUBLE PRECISION,
    "spreadPercent" DOUBLE PRECISION,
    "estimatedSlippagePercent" DOUBLE PRECISION,
    "marketState" TEXT,
    "referenceFreshness" TEXT,
    "liquidityStatus" TEXT,
    "currentPositionUsd" DOUBLE PRECISION,
    "dailyTradedUsd" DOUBLE PRECISION,
    "dailyVolumeUsd" DOUBLE PRECISION,
    "referenceAgeSeconds" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING_RISK',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvaluation" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "rulesPassed" JSONB NOT NULL,
    "rulesFailed" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "requiresReview" JSONB,
    "rulesEvaluated" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskRuleResult" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "warning" TEXT,

    CONSTRAINT "RiskRuleResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeProposal_strategyId_createdAt_idx" ON "TradeProposal"("strategyId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskEvaluation_proposalId_createdAt_idx" ON "RiskEvaluation"("proposalId", "createdAt");

-- AddForeignKey
ALTER TABLE "TradeProposal" ADD CONSTRAINT "TradeProposal_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvaluation" ADD CONSTRAINT "RiskEvaluation_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TradeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRuleResult" ADD CONSTRAINT "RiskRuleResult_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "RiskEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
