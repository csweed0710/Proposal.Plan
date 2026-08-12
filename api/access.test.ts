import { describe, expect, it } from "vitest";
import { hasValidBasicAuth, isPublicRequest } from "./access";

describe("管理介面存取保護", () => {
  it("只允許客戶問卷頁、靜態資產與問卷 API 公開存取", () => {
    expect(isPublicRequest("/intake/secure-token")).toBe(true);
    expect(isPublicRequest("/assets/index.js")).toBe(true);
    expect(isPublicRequest("/api/trpc/share.getForm")).toBe(true);
    expect(isPublicRequest("/api/trpc/share.submit")).toBe(true);

    expect(isPublicRequest("/")).toBe(false);
    expect(isPublicRequest("/clients/3")).toBe(false);
    expect(isPublicRequest("/api/trpc/clients.list")).toBe(false);
    expect(isPublicRequest("/api/trpc/share.getForm,clients.list")).toBe(false);
  });

  it("正確驗證 Basic Auth，並拒絕錯誤或畸形憑證", () => {
    const valid = `Basic ${Buffer.from("owner:a-long-password").toString("base64")}`;
    const invalid = `Basic ${Buffer.from("owner:wrong").toString("base64")}`;
    expect(hasValidBasicAuth(valid, "owner", "a-long-password")).toBe(true);
    expect(hasValidBasicAuth(invalid, "owner", "a-long-password")).toBe(false);
    expect(hasValidBasicAuth("Bearer token", "owner", "a-long-password")).toBe(false);
    expect(hasValidBasicAuth("Basic !!!", "owner", "a-long-password")).toBe(false);
  });
});
