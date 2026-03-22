import { inngest } from "@/lib/inngest";
import { getValidToken } from "@/lib/spotify-token";
import { fetchLikedSongs } from "@/lib/spotify";
import { trackRepository } from "@/repositories/track.repository";
import { userRepository } from "@/repositories/user.repository";

export const syncLibrary = inngest.createFunction(
  {
    id: "sync-library",
    retries: 3,
    concurrency: [{ key: "event.data.userId", limit: 1 }],
    triggers: [{ event: "library/sync.requested" }],
    onFailure: async ({ event }) => {
      const userId = event.data.event.data.userId;
      if (typeof userId === "string") {
        await userRepository.setSyncStatus(userId, "FAILED");
      }
    },
  },
  async ({ event, step }) => {
    const userId = event.data.userId;
    if (typeof userId !== "string") {
      throw new Error("library/sync.requested requires a string userId");
    }

    // Also set by the tRPC mutation, but repeated here so the function is
    // self-contained if triggered from a different entry point (e.g. cron).
    await step.run("set-syncing", async () => {
      await userRepository.setSyncStatus(userId, "SYNCING");
    });

    const token = await step.run("get-token", async () => {
      const result = await getValidToken(userId);
      if (!result) {
        throw new Error(
          `No valid Spotify token for user ${userId}. User may need to re-authenticate.`
        );
      }
      return result;
    });

    const songs = await step.run("fetch-songs", async () => {
      return fetchLikedSongs(token.accessToken);
    });

    await step.run("upsert-songs", async () => {
      // Inngest serializes step outputs to JSON, so Date becomes string.
      // Rehydrate likedAt before passing to the repository.
      const rehydrated = songs.map((s) => ({
        ...s,
        likedAt: new Date(s.likedAt),
      }));
      await trackRepository.upsertMany(userId, rehydrated);
    });

    await step.run("update-status", async () => {
      await userRepository.updateSyncMetrics(userId);
      await userRepository.setSyncStatus(userId, "IDLE");
    });

    return { synced: songs.length };
  }
);
