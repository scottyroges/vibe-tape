import { router } from "@/server/trpc";
import { healthRouter } from "@/server/routers/health";

export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
