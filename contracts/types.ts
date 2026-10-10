export type * from "../db/schema";
export * from "./errors";

// ─── Shared search types (frontend ↔ backend ↔ public API) ──────────────────

export type SearchType = "patents" | "trademarks";
export type PatentSort = "relevance" | "newest" | "oldest";
export type TrademarkStatus = "all" | "live" | "dead";

export interface PatentResult {
  id: string; // guid e.g. US-20260255336-A1
  documentId: string; // e.g. "US 20260255336 A1"
  title: string;
  type: "US-PGPUB" | "USPAT" | "USOCR" | string;
  kind: "application" | "grant" | "other";
  publicationNumber: string;
  datePublished: string | null;
  filingDate: string | null;
  applicants: string[];
  inventors: string | null;
  ipc: string | null;
  cpc: string | null;
  applicationNumber: string | null;
  url: string; // external viewer link
}

export interface PatentSearchResponse {
  type: "patents";
  query: string;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  results: PatentResult[];
  source: string;
}

export interface TrademarkResult {
  serialNumber: string;
  wordmark: string;
  status: string | null;
  statusCode: number | null;
  alive: boolean;
  registered: boolean;
  registrationNumber: string | null;
  registrationDate: string | null;
  filingDate: string | null;
  publicationDate: string | null;
  abandonmentDate: string | null;
  owner: string | null;
  ownerEntity: string | null;
  ownerAddress: string | null;
  goodsAndServices: string[];
  internationalClasses: string[];
  markType: string[];
  designPhrases: string[];
  markDescription: string[];
  attorney: string | null;
  drawingCode: string | null;
  disclaimer: string | null;
  url: string; // TSDR status link
}

export interface TrademarkSearchResponse {
  type: "trademarks";
  query: string;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  results: TrademarkResult[];
  source: string;
}

export interface ApiError {
  error: string;
  message: string;
}
