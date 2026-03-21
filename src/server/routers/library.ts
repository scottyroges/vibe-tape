import { router, protectedProcedure } from "@/server/trpc";
import { inngest } from "@/lib/inngest";
import { trackRepository } from "@/repositories/track.repository";
import { userRepository } from "@/repositories/user.repository";

export const libraryRouter = router({
  sync: protectedProcedure.mutation(async ({ ctx }) => {
    const didSet = await userRepository.trySetSyncing(ctx.userId);
    if (!didSet) {
      return { status: "already_syncing" as const };
    }
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

  syncStatus: protectedProcedure.query(async ({ ctx }) => {
    const status = await userRepository.getSyncStatus(ctx.userId);
    return { status };
  }),
});
