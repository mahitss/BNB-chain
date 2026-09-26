import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OLYR",
  description: "Autonomous tokenized-equity intelligence and execution on BNB Smart Chain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
