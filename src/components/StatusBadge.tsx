"use client";

import type { LanguageVersionStatus } from "@/components/ui-types";
import { LANGUAGE_VERSION_STATUS_LABELS } from "@/lib/invariants/types";

export function StatusBadge({ status }: { status: LanguageVersionStatus }) {
  return (
    <span className={`chip ${status}`}>
      {LANGUAGE_VERSION_STATUS_LABELS[status] ?? status}
    </span>
  );
}
