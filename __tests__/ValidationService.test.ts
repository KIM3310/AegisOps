import { describe, expect, it } from "vitest";
import { estimateBase64Bytes, normalizeAndValidateImages } from "../server/lib/validation";

describe("server validation helpers", () => {
  it("estimates base64 bytes correctly", () => {
    // "hello"
    expect(estimateBase64Bytes("aGVsbG8=")).toBe(5);
  });

  it("accepts data URL payloads and normalizes mimeType", () => {
    const images = normalizeAndValidateImages(
      [{ data: "data:image/png;base64,aGVsbG8=", mimeType: "image/jpeg" }],
      { maxImages: 8, maxImageBytes: 1024 }
    );

    expect(images).toHaveLength(1);
    expect(images[0].mimeType).toBe("image/png");
    expect(images[0].data).toBe("aGVsbG8=");
  });

  it("rejects unsupported mime types", () => {
    expect(() =>
      normalizeAndValidateImages(
        [{ mimeType: "application/pdf", data: "aGVsbG8=" }],
        { maxImages: 8, maxImageBytes: 1024 }
      )
    ).toThrow("Unsupported image mimeType");
  });

  it("rejects malformed base64 data", () => {
    expect(() =>
      normalizeAndValidateImages(
        [{ mimeType: "image/png", data: "%%%not-base64%%%" }],
        { maxImages: 8, maxImageBytes: 1024 }
      )
    ).toThrow("Invalid image base64 payload");
  });

  it("enforces max image bytes", () => {
    // "hello"
    expect(() =>
      normalizeAndValidateImages(
        [{ mimeType: "image/png", data: "aGVsbG8=" }],
        { maxImages: 8, maxImageBytes: 3 }
      )
    ).toThrow("Image payload too large");
  });

  it("limits normalized images by maxImages", () => {
    const images = normalizeAndValidateImages(
      [
        { mimeType: "image/png", data: "aGVsbG8=" },
        { mimeType: "image/png", data: "d29ybGQ=" },
      ],
      { maxImages: 1, maxImageBytes: 1024 }
    );
    expect(images).toHaveLength(1);
  });

  it("returns no images when maxImages is zero", () => {
    const images = normalizeAndValidateImages(
      [
        { mimeType: "image/png", data: "aGVsbG8=" },
        { mimeType: "image/png", data: "d29ybGQ=" },
      ],
      { maxImages: 0, maxImageBytes: 1024 }
    );
    expect(images).toHaveLength(0);
  });
});
