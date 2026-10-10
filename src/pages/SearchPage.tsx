import { useState } from "react";
import { ClassPicker } from "@/components/ClassPicker";
import { parseClassesParam } from "@contracts/conflicts";
import { VerdictCard } from "@/components/VerdictCard";
import { useNavigate, useSearchParams } from "react-router";
import {
  BellPlus,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ImageUp,
  LoaderCircle,
  SearchX,
} from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { SearchBar } from "@/components/SearchBar";
import {
  PatentCard,
  PatentDetail,
  TrademarkCard,
  TrademarkDetail,
} from "@/components/Results";
import { ImageSearchDialog } from "@/components/ImageSearch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import type {
  PatentResult,
  PatentSort,
  SearchType,
  TrademarkResult,
  TrademarkStatus,
} from "@contracts/types";

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-4 mt-8">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg border bg-white disabled:opacity-40 hover:border-navy-300"
      >
        <ChevronLeft className="w-4 h-4" /> Prev
      </button>
      <span className="text-sm text-slate-500">
        Page {page} of {Math.min(totalPages, 999).toLocaleString()}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg border bg-white disabled:opacity-40 hover:border-navy-300"
      >
        Next <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function LoadingList() {
  return (
    <div className="space-y-3 mt-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-8 bg-red-50 border border-red-200 text-red-700 rounded-xl p-5 text-sm">
      <div className="font-medium mb-1">Search failed</div>
      {message} — the USPTO service may be busy; try again in a moment.
    </div>
  );
}

function Empty({ query }: { query: string }) {
  return (
    <div className="mt-12 text-center text-slate-500">
      <SearchX className="w-10 h-10 mx-auto mb-3 text-slate-300" />
      <p className="font-medium text-slate-700">No results for “{query}”</p>
      <p className="text-sm mt-1">
        Try a different spelling, fewer words, or a broader term.
      </p>
    </div>
  );
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const q = params.get("q") ?? "";
  const type = (params.get("type") ?? "trademarks") as SearchType;
  const status = (params.get("status") ?? "live") as TrademarkStatus;
  const classes = parseClassesParam(params.get("classes"));
  const [showAll, setShowAll] = useState(false);
  const sort = (params.get("sort") ?? "newest") as PatentSort;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const option = type === "trademarks" ? status : sort;

  const saveMut = trpc.library.saveSearch.useMutation({
    onSuccess: () => {
      utils.library.listSaved.invalidate();
      toast.success("Search saved — find it under My searches");
    },
    onError: (e) => toast.error(e.message),
  });
  const watchMut = trpc.library.addWatch.useMutation({
    onSuccess: () => {
      utils.library.listWatches.invalidate();
      toast.success(
        "Watching — we'll alert you when new results appear",
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const needLogin = () => {
    toast("Sign in to save and watch searches", {
      action: { label: "Sign in", onClick: () => navigate("/login") },
    });
  };

  const [imageSearchOpen, setImageSearchOpen] = useState(false);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== "page") next.set("page", "1");
    setParams(next);
  };

  const onSearch = (query: string, t: SearchType) =>
    navigate(
      `/search?q=${encodeURIComponent(query)}&type=${t}&status=live&sort=newest`,
    );

  const tmQuery = trpc.search.trademarks.useQuery(
    { query: q, status, page, perPage: 25 },
    { enabled: type === "trademarks" && !!q, placeholderData: (p) => p },
  );
  // Verdict layer: skip for serial numbers / fielded power-user syntax
  const isNameQuery =
    q.trim().length >= 2 && !/^\d{6,8}$/.test(q.trim()) && !/^[a-z]+:/i.test(q.trim());
  const checkQuery = trpc.search.trademarkCheck.useQuery(
    { query: q.trim().slice(0, 100), classes },
    { enabled: type === "trademarks" && isNameQuery, retry: false, staleTime: 5 * 60_000 },
  );
  const listOpen = showAll || page > 1 || !isNameQuery;

  const patQuery = trpc.search.patents.useQuery(
    { query: q, page, perPage: 25, sort },
    { enabled: type === "patents" && !!q, placeholderData: (p) => p },
  );

  const [selectedTm, setSelectedTm] = useState<TrademarkResult | null>(null);
  const [selectedPat, setSelectedPat] = useState<PatentResult | null>(null);

  return (
    <Layout>
      <div className="bg-slate-50 border-b">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <SearchBar
            initialQuery={q}
            initialType={type}
            onSearch={onSearch}
            key={`${q}-${type}`}
          />
          {q && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() =>
                  isAuthenticated
                    ? saveMut.mutate({ label: q, type, query: q, option })
                    : needLogin()
                }
                disabled={saveMut.isPending}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border bg-white text-slate-600 hover:border-navy-300 hover:text-navy-700 transition-colors"
              >
                <Bookmark className="w-3.5 h-3.5" /> Save search
              </button>
              <button
                onClick={() =>
                  isAuthenticated
                    ? watchMut.mutate({ label: q, type, query: q, option })
                    : needLogin()
                }
                disabled={watchMut.isPending}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border bg-white text-slate-600 hover:border-navy-300 hover:text-navy-700 transition-colors"
              >
                <BellPlus className="w-3.5 h-3.5" /> Watch for new results
              </button>
              {type === "trademarks" && (
                <button
                  onClick={() => setImageSearchOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border bg-white text-slate-600 hover:border-navy-300 hover:text-navy-700 transition-colors"
                >
                  <ImageUp className="w-3.5 h-3.5" /> Search by image
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {type === "trademarks" && (
          <>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm text-slate-500">
                {tmQuery.data ? (
                  <>
                    <span className="font-semibold text-slate-900">
                      {tmQuery.data.total.toLocaleString()}
                    </span>{" "}
                    trademarks for “{q}”
                  </>
                ) : (
                  "Searching trademarks…"
                )}
              </div>
              <Select
                value={status}
                onValueChange={(v) => setParam("status", v)}
              >
                <SelectTrigger className="w-44 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="live">Live only</SelectItem>
                  <SelectItem value="dead">Dead only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isNameQuery && (
              <div className="mt-4 space-y-3">
                <ClassPicker
                  value={classes}
                  onChange={(c) => setParam("classes", c.join(","))}
                />
                <VerdictCard
                  data={checkQuery.data}
                  loading={checkQuery.isFetching}
                  error={checkQuery.error?.message}
                  footer={
                    checkQuery.data && checkQuery.data.verdict !== "unknown" ? (
                      <div className="mt-3 text-sm">
                        <a
                          href={`/namecheck?name=${encodeURIComponent(q)}&classes=${classes.join(",")}`}
                          className="font-medium text-navy-700 underline"
                        >
                          Run the full name check and get the clearance report →
                        </a>
                      </div>
                    ) : null
                  }
                />
              </div>
            )}

            {!listOpen ? (
              <button
                onClick={() => setShowAll(true)}
                className="mt-5 w-full rounded-xl border border-dashed border-slate-300 bg-white py-3 text-sm font-medium text-slate-700 hover:border-navy-400 hover:text-navy-700"
              >
                Show all {tmQuery.data ? tmQuery.data.total.toLocaleString() : ""}{" "}
                {status === "live" ? "live " : status === "dead" ? "dead " : ""}results
              </button>
            ) : (
              <>
            {tmQuery.isLoading && <LoadingList />}
              {tmQuery.error && <ErrorBox message={tmQuery.error.message} />}
              {tmQuery.data && tmQuery.data.results.length === 0 && (
                <Empty query={q} />
              )}
              <div className="space-y-3 mt-5">
                {tmQuery.data?.results.map((tm) => (
                  <TrademarkCard
                    key={tm.serialNumber}
                    tm={tm}
                    onOpen={() => setSelectedTm(tm)}
                  />
                ))}
              </div>
              {tmQuery.data && (
                <Pagination
                  page={page}
                  totalPages={tmQuery.data.totalPages}
                  onPage={(p) => setParam("page", String(p))}
                />
              )}
              {tmQuery.isFetching && !tmQuery.isLoading && (
                <div className="flex justify-center mt-4 text-slate-400">
                  <LoaderCircle className="w-5 h-5 animate-spin" />
                </div>
              )}
              </>
            )}
            <TrademarkDetail
              tm={selectedTm}
              open={!!selectedTm}
              onClose={() => setSelectedTm(null)}
            />
            <ImageSearchDialog
              open={imageSearchOpen}
              onClose={() => setImageSearchOpen(false)}
              initialText={q}
              onOpenTrademark={(tm) => {
                setImageSearchOpen(false);
                setSelectedTm(tm);
              }}
            />
          </>
        )}

        {type === "patents" && (
          <>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm text-slate-500">
                {patQuery.data ? (
                  <>
                    <span className="font-semibold text-slate-900">
                      {patQuery.data.total.toLocaleString()}
                    </span>{" "}
                    patent documents for “{q}”
                  </>
                ) : (
                  "Searching patents…"
                )}
              </div>
              <Select value={sort} onValueChange={(v) => setParam("sort", v)}>
                <SelectTrigger className="w-44 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="relevance">Most relevant</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {patQuery.isLoading && <LoadingList />}
            {patQuery.error && <ErrorBox message={patQuery.error.message} />}
            {patQuery.data && patQuery.data.results.length === 0 && (
              <Empty query={q} />
            )}
            <div className="space-y-3 mt-5">
              {patQuery.data?.results.map((p) => (
                <PatentCard key={p.id} patent={p} onOpen={() => setSelectedPat(p)} />
              ))}
            </div>
            {patQuery.data && (
              <Pagination
                page={page}
                totalPages={patQuery.data.totalPages}
                onPage={(p) => setParam("page", String(p))}
              />
            )}
            {patQuery.isFetching && !patQuery.isLoading && (
              <div className="flex justify-center mt-4 text-slate-400">
                <LoaderCircle className="w-5 h-5 animate-spin" />
              </div>
            )}
            <PatentDetail
              patent={selectedPat}
              open={!!selectedPat}
              onClose={() => setSelectedPat(null)}
            />
          </>
        )}
      </div>
    </Layout>
  );
}
