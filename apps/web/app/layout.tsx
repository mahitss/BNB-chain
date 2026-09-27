import type { Metadata } from "next";
import Providers from "./providers";
import AppShell from "../components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "OLYR — Tokenized Equity Intelligence",
  description:
    "Autonomous intelligence and controlled execution for tokenized equities on BNB Smart Chain.",
  applicationName: "OLYR",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
