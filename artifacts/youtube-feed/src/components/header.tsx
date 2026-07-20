import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Bookmark, Search } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Search", icon: Search },
  { href: "/saved", label: "Saved", icon: Bookmark },
];

export function Header({ children }: { children?: ReactNode }) {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-40 border-b border-border glass-panel">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <img
            src={`${import.meta.env.BASE_URL}images/logo.png`}
            className="w-8 h-8 rounded-xl shadow"
            alt="Logo"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span className="font-display font-bold text-xl tracking-tight text-white hidden sm:block">
            Tube<span className="text-primary">DL</span>
          </span>
        </Link>

        {children}

        {/* Nav */}
        <nav className="flex items-center gap-1 shrink-0">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                location === href
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:text-text-main hover:bg-surface-hover"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
