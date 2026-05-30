import { WalletButton } from "./WalletButton";

export function Navbar() {
  return (
    <nav className="w-full h-14 bg-surface-container-lowest border-b border-surface-container flex justify-between items-center px-4 shrink-0 z-50">
      {/* Brand / Left */}
      <div className="flex items-center gap-6">
        <div className="font-display-md text-[20px] font-bold tracking-tighter text-white flex items-center gap-2">
          <span
            className="material-symbols-outlined text-electric-indigo"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            token
          </span>
          KONAHRIK
        </div>

        {/* Navigation Links */}
        <div className="hidden md:flex gap-4 items-center">
          <a
            className="text-white text-[14px] font-medium py-4 transition-colors"
            href="#"
          >
            Terminal
          </a>
          <a
            className="text-on-surface-variant text-[14px] font-medium py-4 hover:text-white transition-colors"
            href="#"
          >
            Dashboard
          </a>
          <a
            className="text-on-surface-variant text-[14px] font-medium py-4 hover:text-white transition-colors"
            href="#"
          >
            Positions
          </a>
        </div>
      </div>

      {/* Trailing Actions */}
      <div className="flex items-center gap-3">
        <button className="w-8 h-8 rounded hover:bg-surface-container transition-colors text-outline flex items-center justify-center">
          <span className="material-symbols-outlined text-[20px]">search</span>
        </button>
        <button className="w-8 h-8 rounded hover:bg-surface-container transition-colors text-outline flex items-center justify-center mr-2">
          <span className="material-symbols-outlined text-[20px]">
            settings
          </span>
        </button>
        <WalletButton />
      </div>
    </nav>
  );
}
