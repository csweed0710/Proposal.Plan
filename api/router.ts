import { createRouter, publicQuery } from "./middleware";
import { grantRouter, clientRouter, caseRouter, reviewRouter, referenceRouter, metaRouter } from "./features";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  grants: grantRouter,
  clients: clientRouter,
  cases: caseRouter,
  review: reviewRouter,
  references: referenceRouter,
  meta: metaRouter,
});

export type AppRouter = typeof appRouter;
