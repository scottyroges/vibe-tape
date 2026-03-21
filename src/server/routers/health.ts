import { router, publicProcedure } from "@/server/trpc";

export const healthRouter = router({
  ping: publicProcedure.query(() => {
    return {
      status: "ok" as const,
      timestamp: new Date(),
    };
  }),
});
