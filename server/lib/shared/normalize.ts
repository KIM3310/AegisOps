/**
 * Shared report normalization functions for incident report fields.
 */

import type { IncidentReport } from "../../../types";
import { asString } from "./llm-utils";

export function normalizeTimeline(value: unknown): IncidentReport["timeline"] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 30)
    .map((item: any) => {
      const severity = ["critical", "warning", "info", "success"].includes(item?.severity)
        ? item.severity
        : undefined;
      return {
        time: asString(item?.time, "Unknown", 32),
        description: asString(item?.description, "", 400),
        ...(severity ? { severity } : {}),
      };
    })
    .filter((x) => x.description.length > 0);
}

export function normalizeActionItems(value: unknown): IncidentReport["actionItems"] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .map((item: any) => {
      const priority = ["HIGH", "MEDIUM", "LOW"].includes(item?.priority) ? item.priority : "MEDIUM";
      const task = asString(item?.task, "", 500);
      const owner = asString(item?.owner, "", 120);
      return {
        task,
        priority,
        ...(owner ? { owner } : {}),
      };
    })
    .filter((x) => x.task.length > 0);
}
