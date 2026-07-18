import { createRouter, publicQuery } from "./middleware";
import { grantRouter, clientRouter, caseRouter, reviewRouter, metaRouter } from "./features";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  grants: grantRouter,
  clients: clientRouter,
  cases: caseRouter,
  review: reviewRouter,
  meta: metaRouter,
});

export type AppRouter = typeof appRouter;
