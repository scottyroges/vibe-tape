import { router } from "@/server/trpc";
import { healthRouter } from "@/server/routers/health";
import { libraryRouter } from "@/server/routers/library";

export const appRouter = router({
  health: healthRouter,
  library: libraryRouter,
});

export type AppRouter = typeof appRouter;
