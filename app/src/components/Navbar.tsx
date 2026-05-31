"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./WalletButton";

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="w-full h-14 bg-surface-container-lowest border-b border-surface-container flex justify-between items-center px-4 shrink-0 z-50">
      {/* Brand / Left */}
      <div className="flex items-center gap-6">
        <Link
          href="/"
          className="font-display-md text-[20px] font-bold tracking-tighter text-white flex items-center gap-2"
        >
          <span
            className="material-symbols-outlined text-electric-indigo"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            token
          </span>
          KONAHRIK
        </Link>

        {/* Navigation Links */}
        <div className="hidden md:flex gap-4 items-center">
          <Link
            className={`text-[14px] font-medium py-4 transition-colors ${
              pathname === "/terminal"
                ? "text-white"
                : "text-on-surface-variant hover:text-white"
            }`}
            href="/terminal"
          >
            Terminal
          </Link>
          <Link
            className={`text-[14px] font-medium py-4 transition-colors ${
              pathname === "/dashboard"
                ? "text-white"
                : "text-on-surface-variant hover:text-white"
            }`}
            href="/dashboard"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {/* Trailing Actions */}
      <div className="flex items-center gap-3">
        <a
          href="https://github.com/ohmygodashish/konahrik"
          target="_blank"
          rel="noopener noreferrer"
          className="w-8 h-8 rounded hover:bg-surface-container transition-colors text-outline hover:text-white flex items-center justify-center mr-2"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
        </a>
        <WalletButton />
      </div>
    </nav>
  );
}
