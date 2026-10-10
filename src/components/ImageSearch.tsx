import { useRef, useState } from "react";
import { ExternalLink, ImageUp, LoaderCircle, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LiveBadge } from "@/components/Results";
import { trpc } from "@/providers/trpc";
import type { TrademarkResult } from "@contracts/types";

const NICE_CLASSES = Array.from({ length: 45 }, (_, i) => i + 1);

interface ImageHit {
  serialNumber: string;
  wordmark: string;
  status: string | null;
  statusDetail: string | null;
  alive: boolean;
  registered: boolean;
  registrationNumber: string | null;
  filingDate: string | null;
  owner: string | null;
  classes: number[];
  thumbnailUrl: string;
  largeImageUrl: string;
  url: string;
}

interface ImageSearchApiResponse {
  total: number;
  liveCount: number;
  deadCount: number;
  results: ImageHit[];
  message?: string;
}

export function ImageSearchDialog({
  open,
  onClose,
  onOpenTrademark,
  initialText = "",
}: {
  open: boolean;
  onClose: () => void;
  onOpenTrademark: (tm: TrademarkResult) => void;
  initialText?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState(initialText);
  const [status, setStatus] = useState<"all" | "live" | "dead">("all");
  const [cls, setCls] = useState<string>("all");
  const [response, setResponse] = useState<ImageSearchApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const pick = (f: File | null) => {
    setFile(f);
    setResponse(null);
    setError(null);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const canSearch = !!file || !!text.trim();

  const run = async () => {
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      if (text.trim()) form.append("text", text.trim());
      if (status !== "all") form.append("status", status);
      if (cls !== "all") form.append("classes", cls);
      form.append("per_page", "24");
      const res = await fetch("/api/v1/trademarks/image-search", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as ImageSearchApiResponse;
      if (!res.ok) throw new Error(data.message ?? "Image search failed");
      setResponse(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image search failed");
    } finally {
      setLoading(false);
    }
  };

  const openDetails = async (hit: ImageHit) => {
    try {
      const data = await utils.search.trademarks.fetch({
        query: hit.serialNumber,
        status: "all",
        page: 1,
        perPage: 1,
      });
      if (data.results[0]) onOpenTrademark(data.results[0]);
    } catch {
      /* fall back to external link on card */
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trademark image search</DialogTitle>
          <DialogDescription>
            Upload a logo — optionally combined with a keyword — and find
            visually similar U.S. trademarks, powered by the USPTO's image
            similarity engine.
          </DialogDescription>
        </DialogHeader>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files?.[0] ?? null);
          }}
          className="mt-2 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-navy-400 hover:bg-navy-50/40 transition-colors"
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          {preview ? (
            <div className="flex items-center justify-center gap-4">
              <img
                src={preview}
                alt="upload preview"
                className="max-h-28 rounded-lg border bg-white object-contain"
              />
              <div className="text-sm text-slate-600 text-left">
                <div className="font-medium text-slate-900">{file?.name}</div>
                <div className="text-xs mt-1">
                  Click or drop another image to replace
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  pick(null);
                }}
                className="p-1.5 rounded-full hover:bg-slate-200"
                aria-label="Remove image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <ImageUp className="w-8 h-8 mx-auto text-slate-400 mb-2" />
              <p className="text-sm text-slate-600">
                Drop a logo here, or click to browse
              </p>
              <p className="text-xs text-slate-400 mt-1">
                PNG or JPG, up to 5 MB — optional if you use keywords
              </p>
            </>
          )}
        </div>

        <div className="mt-3 grid sm:grid-cols-[1fr_130px_150px] gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Combine with a keyword (optional) — e.g. coffee"
            className="border rounded-lg px-3 py-2 text-sm outline-none focus:border-navy-400"
          />
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as typeof status)}
          >
            <SelectTrigger className="bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="live">Live only</SelectItem>
              <SelectItem value="dead">Dead only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={cls} onValueChange={setCls}>
            <SelectTrigger className="bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All classes</SelectItem>
              {NICE_CLASSES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Class {String(n).padStart(3, "0")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <button
          onClick={run}
          disabled={!canSearch || loading}
          className="mt-3 w-full rounded-xl bg-navy-600 text-white font-medium py-2.5 hover:bg-navy-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
        >
          {loading && <LoaderCircle className="w-4 h-4 animate-spin" />}
          {loading ? "Searching visually similar marks…" : "Find similar marks"}
        </button>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            {error}
          </div>
        )}

        {response && (
          <div className="mt-5">
            <div className="text-sm text-slate-500 mb-3">
              {response.results.length === 0
                ? "No matching marks found."
                : `${response.total.toLocaleString()} similar marks (${response.liveCount.toLocaleString()} live, ${response.deadCount.toLocaleString()} dead) — showing top ${response.results.length}`}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {response.results.map((hit) => (
                <div
                  key={hit.serialNumber}
                  className="border rounded-xl overflow-hidden bg-white hover:border-navy-300 hover:shadow-sm transition-all"
                >
                  <button
                    onClick={() => openDetails(hit)}
                    className="w-full text-left"
                  >
                    <div className="h-28 bg-slate-50 flex items-center justify-center p-2">
                      <img
                        src={hit.thumbnailUrl}
                        alt={hit.wordmark}
                        className="max-h-full max-w-full object-contain"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className="text-xs font-semibold text-slate-900 truncate"
                          title={hit.wordmark}
                        >
                          {hit.wordmark}
                        </div>
                        <LiveBadge alive={hit.alive} />
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-1">
                        {hit.owner ?? `SN ${hit.serialNumber}`}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {[
                          hit.filingDate && `Filed ${hit.filingDate}`,
                          hit.classes.length > 0 &&
                            `Class ${hit.classes.map((n) => String(n).padStart(3, "0")).join(", ")}`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || hit.statusDetail}
                      </div>
                    </div>
                  </button>
                  <a
                    href={hit.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-3 pb-2.5 text-[11px] text-navy-600 hover:text-navy-800"
                  >
                    USPTO record <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
