import { router } from "@/server/trpc";
import { healthRouter } from "@/server/routers/health";
import { libraryRouter } from "@/server/routers/library";
import { playlistRouter } from "@/server/routers/playlist";

export const appRouter = router({
  health: healthRouter,
  library: libraryRouter,
  playlist: playlistRouter,
});

export type AppRouter = typeof appRouter;
