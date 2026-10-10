import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import type { PatentResult, TrademarkResult } from "@contracts/types";
import { cn } from "@/lib/utils";

// ─── Badges ─────────────────────────────────────────────────────────────────

export function LiveBadge({ alive }: { alive: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full",
        alive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          alive ? "bg-emerald-500" : "bg-slate-400",
        )}
      />
      {alive ? "Live" : "Dead"}
    </span>
  );
}

export function KindBadge({ kind }: { kind: PatentResult["kind"] }) {
  if (kind === "grant")
    return (
      <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">
        Granted patent
      </Badge>
    );
  if (kind === "application")
    return (
      <Badge className="bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-50">
        Application
      </Badge>
    );
  return <Badge variant="secondary">Document</Badge>;
}

// ─── Trademark card + detail ────────────────────────────────────────────────

export function TrademarkCard({
  tm,
  onOpen,
}: {
  tm: TrademarkResult;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white border rounded-xl p-4 hover:border-navy-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate text-lg">
            {tm.wordmark}
          </div>
          <div className="text-sm text-slate-500 truncate mt-0.5">
            {tm.owner ?? "Unknown owner"}
          </div>
        </div>
        <LiveBadge alive={tm.alive} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
        <span>SN {tm.serialNumber}</span>
        {tm.registrationNumber && <span>Reg. {tm.registrationNumber}</span>}
        {tm.filingDate && <span>Filed {tm.filingDate}</span>}
        {tm.status && (
          <span className="truncate max-w-64">{tm.status}</span>
        )}
      </div>
    </button>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-2 border-b border-slate-100 last:border-0 text-sm">
      <div className="text-slate-500">{label}</div>
      <div className="text-slate-900 break-words">{value}</div>
    </div>
  );
}

export function TrademarkDetail({
  tm,
  open,
  onClose,
}: {
  tm: TrademarkResult | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        {tm && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <SheetTitle className="text-2xl">{tm.wordmark}</SheetTitle>
                <LiveBadge alive={tm.alive} />
              </div>
              <SheetDescription>
                U.S. trademark serial no. {tm.serialNumber}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              <DetailRow label="Status" value={tm.status} />
              <DetailRow label="Serial no." value={tm.serialNumber} />
              <DetailRow
                label="Registration no."
                value={tm.registrationNumber}
              />
              <DetailRow label="Mark type" value={tm.markType.join(", ")} />
              <DetailRow label="Filed" value={tm.filingDate} />
              <DetailRow label="Registered" value={tm.registrationDate} />
              <DetailRow label="Published" value={tm.publicationDate} />
              <DetailRow label="Abandoned" value={tm.abandonmentDate} />
              <DetailRow label="Owner" value={tm.owner} />
              <DetailRow label="Owner address" value={tm.ownerAddress} />
              <DetailRow
                label="Classes"
                value={tm.internationalClasses.join(", ")}
              />
              <DetailRow label="Attorney" value={tm.attorney} />
              <DetailRow label="Disclaimer" value={tm.disclaimer} />
            </div>
            {tm.goodsAndServices.length > 0 && (
              <div className="mt-5">
                <div className="text-sm font-medium text-slate-900 mb-2">
                  Goods &amp; services
                </div>
                <ul className="space-y-2 text-sm text-slate-600 list-disc pl-5">
                  {tm.goodsAndServices.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
            {tm.markDescription.length > 0 && (
              <div className="mt-5">
                <div className="text-sm font-medium text-slate-900 mb-2">
                  Mark description
                </div>
                <p className="text-sm text-slate-600">
                  {tm.markDescription.join(" ")}
                </p>
              </div>
            )}
            {tm.designPhrases.length > 0 && (
              <div className="mt-5">
                <div className="text-sm font-medium text-slate-900 mb-2">
                  Design elements
                </div>
                <ul className="space-y-1 text-sm text-slate-600 list-disc pl-5">
                  {tm.designPhrases.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <a
                href={tm.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-navy-600 hover:text-navy-800"
              >
                View official status on USPTO TSDR
                <ExternalLink className="w-4 h-4" />
              </a>
              <Link
                to="/register-help"
                className="inline-flex items-center gap-2 text-sm font-medium text-navy-600 hover:text-navy-800"
              >
                <ShieldCheck className="w-4 h-4" />
                Want this name? How to register your own mark
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Patent card + detail ───────────────────────────────────────────────────

export function PatentCard({
  patent,
  onOpen,
}: {
  patent: PatentResult;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white border rounded-xl p-4 hover:border-navy-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-semibold text-slate-900 leading-snug">
          {patent.title}
        </div>
        <KindBadge kind={patent.kind} />
      </div>
      <div className="text-sm text-slate-500 mt-1.5 truncate">
        {patent.applicants.join(", ") || patent.inventors || "Unknown applicant"}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
        <span className="font-medium text-slate-600">{patent.documentId}</span>
        {patent.datePublished && <span>Published {patent.datePublished}</span>}
        {patent.filingDate && <span>Filed {patent.filingDate}</span>}
      </div>
    </button>
  );
}

export function PatentDetail({
  patent,
  open,
  onClose,
}: {
  patent: PatentResult | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        {patent && (
          <>
            <SheetHeader>
              <div className="flex items-start gap-3">
                <SheetTitle className="text-xl leading-snug">
                  {patent.title}
                </SheetTitle>
              </div>
              <SheetDescription className="flex items-center gap-2">
                {patent.documentId} <KindBadge kind={patent.kind} />
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              <DetailRow
                label="Applicants"
                value={patent.applicants.join("; ")}
              />
              <DetailRow label="Inventors" value={patent.inventors} />
              <DetailRow label="Published" value={patent.datePublished} />
              <DetailRow label="Filed" value={patent.filingDate} />
              <DetailRow
                label="Application no."
                value={patent.applicationNumber}
              />
              <DetailRow label="IPC class" value={patent.ipc} />
              <DetailRow label="CPC class" value={patent.cpc} />
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <a
                href={patent.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-navy-600 hover:text-navy-800"
              >
                View full text on Google Patents
                <ExternalLink className="w-4 h-4" />
              </a>
              <a
                href="https://ppubs.uspto.gov/pubwebapp/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-navy-600 hover:text-navy-800"
              >
                Open USPTO Patent Public Search
                <ExternalLink className="w-4 h-4" />
              </a>
              <Link
                to="/register-help?topic=patent"
                className="inline-flex items-center gap-2 text-sm font-medium text-navy-600 hover:text-navy-800"
              >
                <ShieldCheck className="w-4 h-4" />
                Invented something similar? How to protect it
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
