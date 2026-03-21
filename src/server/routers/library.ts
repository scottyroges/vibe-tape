import { router, protectedProcedure } from "@/server/trpc";
import { inngest } from "@/lib/inngest";
import { trackRepository } from "@/repositories/track.repository";

export const libraryRouter = router({
  sync: protectedProcedure.mutation(async ({ ctx }) => {
    await inngest.send({
      name: "library/sync.requested",
      data: { userId: ctx.userId },
    });
    return { status: "started" as const };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return trackRepository.findByUserId(ctx.userId);
  }),

  count: protectedProcedure.query(async ({ ctx }) => {
    const count = await trackRepository.countByUserId(ctx.userId);
    return { count };
  }),
});
