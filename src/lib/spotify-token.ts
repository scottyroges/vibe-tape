import "server-only";

import { db } from "@/lib/db";

interface ValidToken {
  accessToken: string;
}

/**
 * Get a valid Spotify access token for a user, refreshing if expired.
 * Reads from Better Auth's `account` table.
 * Returns null if user needs to re-authenticate.
 */
export async function getValidToken(
  userId: string
): Promise<ValidToken | null> {
  const account = await db
    .selectFrom("account")
    .select([
      "accessToken",
      "refreshToken",
      "accessTokenExpiresAt",
    ])
    .where("userId", "=", userId)
    .where("providerId", "=", "spotify")
    .executeTakeFirst();

  if (!account?.accessToken || !account.refreshToken) {
    return null;
  }

  const now = new Date();
  const expiresAt = account.accessTokenExpiresAt
    ? new Date(account.accessTokenExpiresAt as unknown as string)
    : null;

  // If token is still valid (with 60s buffer), return it
  if (expiresAt && expiresAt.getTime() - 60_000 > now.getTime()) {
    return { accessToken: account.accessToken };
  }

  // Refresh the token
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
  });

  if (!res.ok) {
    // Refresh token revoked — mark user for re-auth
    await db
      .updateTable("user")
      .set({ needsReauth: true })
      .where("id", "=", userId)
      .execute();
    return null;
  }

  const tokens = await res.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db
    .updateTable("account")
    .set({
      accessToken: tokens.access_token,
      accessTokenExpiresAt: newExpiresAt,
      ...(tokens.refresh_token
        ? { refreshToken: tokens.refresh_token }
        : {}),
    })
    .where("userId", "=", userId)
    .where("providerId", "=", "spotify")
    .execute();

  return { accessToken: tokens.access_token };
}
