/**
 * Shapes returned by the JSON API, mirrored for the UI.
 */

import type { MarketField } from "@/lib/market-schema";
import type { TargetLanguage } from "@/lib/languages";
import type {
  LanguageVersionStatus,
  ValidationIssue,
  ValidationReport,
  ExtractedInvariant,
  FieldValidationResult,
} from "@/lib/invariants/types";

export type { LanguageVersionStatus, ValidationIssue, ValidationReport };
export type { ExtractedInvariant, FieldValidationResult };

export interface ProviderStatusJson {
  mode: "live" | "demo-fixtures";
  providerId: string;
  label: string;
  isLive: boolean;
  description: string;
  sarvamKeyConfigured: boolean;
}

export interface MarketSummaryJson {
  id: string;
  title: string;
  isDemo: boolean;
  closingAt: string;
  timezone: string;
  versionCount: number;
  verifiedCount: number;
  publishedCount: number;
  blockedCount: number;
}

export interface MarketSourceJson {
  id: string;
  isDemo: boolean;
  createdAt?: string;
  title: string;
  question: string;
  resolutionRules: string;
  closingAt: string;
  timezone: string;
  resolutionSource: string;
}

export interface TranslatedMarketJson {
  marketId: string;
  language: TargetLanguage;
  title: string;
  question: string;
  resolutionRules: string;
  closingAt: string;
  resolutionSource: string;
  providerId: string;
  isLiveProvider: boolean;
  translatedAt: string;
}

export interface AcknowledgementJson {
  issueId: string;
  reviewer: string;
  note: string;
  at: string;
}

export interface AuditEventJson {
  id: string;
  at: string;
  actor: string;
  action: string;
  marketId: string;
  language?: TargetLanguage;
  field?: MarketField;
  previousStatus?: LanguageVersionStatus;
  newStatus?: LanguageVersionStatus;
  summary: string;
  details?: Record<string, unknown>;
}

export interface LanguageVersionStateJson {
  versionId: string;
  marketId: string;
  language: TargetLanguage;
  status: LanguageVersionStatus;
  translated?: TranslatedMarketJson;
  validation?: ValidationReport;
  currentHash: string;
  lastValidatedHash: string;
  acknowledgements: AcknowledgementJson[];
  revision: number;
  audit: AuditEventJson[];
  providerId?: string;
  providerLabel?: string;
  isLiveProvider?: boolean;
  providerRequestIds: string[];
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export interface PublishGateReasonJson {
  code: string;
  message: string;
  issues?: ValidationIssue[];
}

export interface PublishGateJson {
  allowed: boolean;
  reasons: PublishGateReasonJson[];
  derivedStatus: LanguageVersionStatus;
  summary: string;
}

export interface VersionDetailJson {
  version: LanguageVersionStateJson;
  derivedStatus: LanguageVersionStatus;
  gate: PublishGateJson;
}

export interface MarketDetailJson {
  market: MarketSourceJson;
  versions: VersionDetailJson[];
  provider: ProviderStatusJson;
}

export interface TranslateResponseJson {
  marketId: string;
  provider: ProviderStatusJson;
  versions: {
    versionId: string;
    language: TargetLanguage;
    status: LanguageVersionStatus;
    error?: { code: string; message: string };
    validation?: {
      status: string;
      invariantsChecked: number;
      invariantsMatched: number;
      blockingIssueCount: number;
      reviewIssueCount: number;
    };
  }[];
}
