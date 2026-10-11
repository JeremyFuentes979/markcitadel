import { Link } from "react-router";
import { Bell, Bookmark, Landmark, LogOut, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const unread = trpc.library.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-lg bg-navy-800 flex items-center justify-center text-brass-300 group-hover:bg-navy-900 transition-colors">
              <Landmark className="w-5 h-5" />
            </div>
            <div className="leading-tight">
              <div className="font-bold text-slate-900">MarkCitadel</div>
              <div className="text-[11px] text-slate-500 -mt-0.5 tracking-wide uppercase">
                IP Search Connector
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/"
              className="hidden sm:block px-3 py-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Search
            </Link>
            <Link
              to="/developers"
              className="hidden sm:block px-3 py-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Developers
            </Link>
            <Link
              to="/pricing"
              className="hidden sm:block px-3 py-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Pricing
            </Link>
            <Link
              to="/register-help"
              className="hidden md:block px-3 py-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              How to register
            </Link>
            <Link
              to="/namecheck"
              className="hidden md:block px-3 py-2 rounded-md text-navy-700 font-medium hover:bg-navy-50 transition-colors"
            >
              Name check
            </Link>
            <a
              href="/api/v1/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="ml-1 px-3 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              OpenAPI
            </a>
            {!isLoading &&
              (isAuthenticated ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="ml-2 flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 hover:border-navy-300 transition-colors">
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt=""
                        className="w-7 h-7 rounded-full"
                      />
                    ) : (
                      <span className="w-7 h-7 rounded-full bg-navy-100 text-navy-700 flex items-center justify-center">
                        <UserRound className="w-4 h-4" />
                      </span>
                    )}
                    <span className="max-w-28 truncate text-slate-700">
                      {user?.name ?? "Account"}
                    </span>
                    {(unread.data ?? 0) > 0 && (
                      <span className="min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
                        {unread.data}
                      </span>
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem asChild>
                      <Link to="/library" className="flex items-center gap-2">
                        <Bookmark className="w-4 h-4" /> My searches &amp;
                        watches
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        to="/alerts"
                        className="flex items-center gap-2 justify-between"
                      >
                        <span className="flex items-center gap-2">
                          <Bell className="w-4 h-4" /> Alerts
                        </span>
                        {(unread.data ?? 0) > 0 && (
                          <span className="min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
                            {unread.data}
                          </span>
                        )}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={logout}
                      className="flex items-center gap-2 text-slate-600"
                    >
                      <LogOut className="w-4 h-4" /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Link
                  to="/login"
                  className="ml-2 px-3 py-2 rounded-md border text-slate-700 hover:border-navy-400 hover:text-navy-700 transition-colors"
                >
                  Sign in
                </Link>
              ))}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t bg-slate-50 mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-slate-500 space-y-3">
          <p>
            MarkCitadel searches live public data from the United
            States Patent and Trademark Office (USPTO Open Data Portal, Patent
            Public Search, and Trademark Search). This service is not
            affiliated with or endorsed by the USPTO. Results are provided for
            informational purposes only and are not legal advice — always
            verify against the official USPTO record, and consult a licensed
            IP attorney for clearance, filing, or enforcement decisions.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-400">
            <span>
              Patents:{" "}
              <a
                className="underline hover:text-slate-600"
                href="https://data.uspto.gov"
                target="_blank"
                rel="noreferrer"
              >
                data.uspto.gov
              </a>
            </span>
            <span>
              Trademarks:{" "}
              <a
                className="underline hover:text-slate-600"
                href="https://tmsearch.uspto.gov/"
                target="_blank"
                rel="noreferrer"
              >
                tmsearch.uspto.gov
              </a>
            </span>
            <span>
              Status details:{" "}
              <a
                className="underline hover:text-slate-600"
                href="https://tsdr.uspto.gov/"
                target="_blank"
                rel="noreferrer"
              >
                tsdr.uspto.gov
              </a>
            </span>
            <Link to="/register-help" className="underline hover:text-slate-600">
              How to register
            </Link>
            <Link to="/terms" className="underline hover:text-slate-600">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
