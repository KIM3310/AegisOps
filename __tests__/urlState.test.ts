import { describe, expect, it } from "vitest";

import {
  buildReviewShareUrl,
  buildReviewUrlSearch,
  parseReviewUrlState,
  slugifyPresetName,
} from "../utils/urlState";

describe("review url state", () => {
  it("parses review url state", () => {
    expect(
      parseReviewUrlState(
        "?preset=llm-latency-spike&incident=inc-77&grounding=1&tm=0&history=1"
      )
    ).toEqual({
      preset: "llm-latency-spike",
      incident: "inc-77",
      grounding: true,
      tm: false,
      history: true,
    });
  });

  it("serializes review url state", () => {
    expect(
      buildReviewUrlSearch({
        preset: "llm-latency-spike",
        incident: "inc-77",
        grounding: true,
        tm: false,
        history: true,
      })
    ).toBe(
      "preset=llm-latency-spike&incident=inc-77&grounding=1&tm=0&history=1"
    );
  });

  it("builds absolute share urls", () => {
    expect(
      buildReviewShareUrl("preset=llm-latency-spike", {
        origin: "https://aegisops.example",
        pathname: "/",
      })
    ).toBe("https://aegisops.example/?preset=llm-latency-spike");
  });

  it("slugifies preset names", () => {
    expect(slugifyPresetName("LLM Latency Spike")).toBe("llm-latency-spike");
  });
});
