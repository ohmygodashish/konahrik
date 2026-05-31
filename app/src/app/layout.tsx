import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { SolanaProviders } from "@/providers/SolanaProviders";
import { AnchorProviderWrapper } from "@/providers/AnchorProvider";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "sonner";
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

const BASE_URL = "https://konahrik.vercel.app";

export const metadata: Metadata = {
  title: "Konahrik",
  description: "Virtual AMM perpetual futures trading terminal on Solana",
  openGraph: {
    title: "Konahrik",
    description: "Virtual AMM perpetual futures trading terminal on Solana",
    url: BASE_URL,
    images: [
      {
        url: `${BASE_URL}/embed.png`,
        width: 1200,
        height: 630,
        alt: "Konahrik",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Konahrik",
    description: "Virtual AMM perpetual futures trading terminal on Solana",
    images: [`${BASE_URL}/embed.png`],
  },
  icons: {
    icon: [
      { url: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%20-960%20960%20960%22%20width%3D%2224%22%20height%3D%2224%22%3E%3Cpath%20fill%3D%22%236665E7%22%20d%3D%22M370-554%20158-673l322-177%20322%20177-212%20119q-20-27-48.5-42T480-611q-33%200-61.5%2015T370-554Zm99%20437L146-297v-359l214%20122q-5%2014-8%2027t-3%2027q0%2051%2034.5%2088t85.5%2045v230Zm-66.5-285.5Q371-434%20371-480t31.5-77.5Q434-589%20480-589t77.5%2031.5Q589-526%20589-480t-31.5%2077.5Q526-371%20480-371t-77.5-31.5ZM491-117v-230q51-8%2085.5-45t34.5-88q0-14-3-27t-8-27l214-122v359L491-117Z%22/%3E%3C/svg%3E", type: "image/svg+xml" },
    ],
  },
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
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%20-960%20960%20960%22%20width%3D%2224%22%20height%3D%2224%22%3E%3Cpath%20fill%3D%22%236665E7%22%20d%3D%22M370-554%20158-673l322-177%20322%20177-212%20119q-20-27-48.5-42T480-611q-33%200-61.5%2015T370-554Zm99%20437L146-297v-359l214%20122q-5%2014-8%2027t-3%2027q0%2051%2034.5%2088t85.5%2045v230Zm-66.5-285.5Q371-434%20371-480t31.5-77.5Q434-589%20480-589t77.5%2031.5Q589-526%20589-480t-31.5%2077.5Q526-371%20480-371t-77.5-31.5ZM491-117v-230q51-8%2085.5-45t34.5-88q0-14-3-27t-8-27l214-122v359L491-117Z%22/%3E%3C/svg%3E" />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-screen flex flex-col font-body-sm text-body-sm antialiased selection:bg-electric-indigo selection:text-white`}
      >
        <SolanaProviders>
          <AnchorProviderWrapper>
            <Navbar />
            {children}
          </AnchorProviderWrapper>
        </SolanaProviders>
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors
          toastOptions={{
            style: {
              background: "#1f1f24",
              border: "1px solid #292a2e",
              color: "#e3e2e7",
            },
          }}
        />
      </body>
    </html>
  );
}
