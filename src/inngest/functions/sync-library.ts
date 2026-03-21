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
    idempotency: "event.data.userId",
    triggers: [{ event: "library/sync.requested" }],
  },
  async ({ event, step }) => {
    const userId = event.data.userId;
    if (typeof userId !== "string") {
      throw new Error("library/sync.requested requires a string userId");
    }

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
      // Rehydrate addedAt before passing to the repository.
      const rehydrated = songs.map((s) => ({
        ...s,
        addedAt: new Date(s.addedAt),
      }));
      await trackRepository.upsertMany(userId, rehydrated);
    });

    await step.run("update-status", async () => {
      await userRepository.updateSyncStatus(userId);
    });

    return { synced: songs.length };
  }
);
