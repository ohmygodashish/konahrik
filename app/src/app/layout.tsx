import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { SolanaProviders } from "@/providers/SolanaProviders";
import { AnchorProviderWrapper } from "@/providers/AnchorProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KONAHRIK - vAMM Perpetuals DEX",
  description: "Virtual AMM perpetual futures trading terminal on Solana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-screen flex flex-col font-body-sm text-body-sm antialiased selection:bg-electric-indigo selection:text-white`}
      >
        <SolanaProviders>
          <AnchorProviderWrapper>{children}</AnchorProviderWrapper>
        </SolanaProviders>
      </body>
    </html>
  );
}
