import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // 補助雷達：每 6 小時背景掃描一次；失敗只記錄，不影響服務
  const { runRadarScan } = await import("./features");
  const scanOnce = () =>
    runRadarScan()
      .then((r) => console.log("[radar]", JSON.stringify(r.results.map((x) => ({ s: x.source, added: x.added, err: x.error ? 1 : 0 })))))
      .catch((e) => console.warn("[radar] scan failed:", e));
  setTimeout(scanOnce, 3 * 60 * 1000);       // 開機 3 分鐘後首掃
  setInterval(scanOnce, 6 * 60 * 60 * 1000); // 之後每 6 小時
}
