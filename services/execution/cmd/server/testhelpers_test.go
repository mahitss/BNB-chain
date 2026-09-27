package main

import (
	"log/slog"
	"os"
)

// TEST-ONLY throwaway key (same one as the execution package tests).
const testPrivateKeyFixture = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

func testLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, nil))
}
