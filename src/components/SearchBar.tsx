import { useState } from "react";
import { Search, FileText, Tag } from "lucide-react";
import type { SearchType } from "@contracts/types";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  initialQuery?: string;
  initialType?: SearchType;
  onSearch: (query: string, type: SearchType) => void;
  large?: boolean;
}

export function SearchBar({
  initialQuery = "",
  initialType = "trademarks",
  onSearch,
  large = false,
}: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<SearchType>(initialType);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (query.trim()) onSearch(query.trim(), type);
  };

  return (
    <form onSubmit={submit} className="w-full">
      <div
        className={cn(
          "bg-white border rounded-2xl shadow-sm overflow-hidden",
          large && "shadow-lg shadow-navy-100",
        )}
      >
        <div className="flex border-b">
          {(
            [
              { key: "trademarks", label: "Trademarks", icon: Tag },
              { key: "patents", label: "Patents", icon: FileText },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setType(key)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors",
                type === key
                  ? "border-navy-600 text-navy-700 bg-navy-50/50"
                  : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 p-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                type === "trademarks"
                  ? "Search a brand name, owner, or serial number…"
                  : "Search inventions, applicants, or patent numbers…"
              }
              className={cn(
                "w-full pl-10 pr-3 bg-transparent outline-none text-slate-900 placeholder:text-slate-400",
                large ? "py-3.5 text-lg" : "py-2.5",
              )}
              autoFocus={large}
            />
          </div>
          <button
            type="submit"
            disabled={!query.trim()}
            className={cn(
              "rounded-xl bg-navy-600 text-white font-medium hover:bg-navy-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
              large ? "px-8 py-3.5 text-lg" : "px-6 py-2.5",
            )}
          >
            Search
          </button>
        </div>
      </div>
      {large && (
        <p className="text-xs text-slate-500 mt-3 text-center">
          {type === "trademarks" ? (
            <>
              Tip: search a name like <em>apple</em>, an owner like{" "}
              <em>ownerName:nike</em>, or a serial like <em>99551004</em>
            </>
          ) : (
            <>
              Tip: plain text works, or use field codes like <em>drone.ti.</em>{" "}
              (title), <em>tesla.as.</em> (applicant)
            </>
          )}
        </p>
      )}
    </form>
  );
}
