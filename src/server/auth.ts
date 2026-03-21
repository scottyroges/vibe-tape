import "server-only";

import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";

if (!process.env.SPOTIFY_CLIENT_ID) {
  throw new Error("SPOTIFY_CLIENT_ID environment variable is required");
}
if (!process.env.SPOTIFY_CLIENT_SECRET) {
  throw new Error("SPOTIFY_CLIENT_SECRET environment variable is required");
}

function getBaseUrl(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://127.0.0.1:3000";
}

const baseUrl = getBaseUrl();

function getTrustedOrigins(url: string): string[] {
  const origins = [url];

  if (!url.includes("www.")) {
    origins.push(url.replace("://", "://www."));
  }
  if (url.includes("://www.")) {
    origins.push(url.replace("://www.", "://"));
  }

  return origins;
}

export const auth = betterAuth({
  baseURL: baseUrl,
  trustedOrigins: getTrustedOrigins(baseUrl),
  database: { db, type: "postgres" as const },
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "spotify",
          clientId: process.env.SPOTIFY_CLIENT_ID,
          clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
          authorizationUrl: "https://accounts.spotify.com/authorize",
          tokenUrl: "https://accounts.spotify.com/api/token",
          scopes: [
            "user-read-email",
            "user-library-read",
            "playlist-modify-public",
            "playlist-modify-private",
          ],
          getUserInfo: async (tokens) => {
            const res = await fetch("https://api.spotify.com/v1/me", {
              headers: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            });
            const profile = await res.json();
            return {
              id: profile.id,
              name: profile.display_name ?? profile.id,
              email: profile.email,
              image: profile.images?.[0]?.url ?? null,
              emailVerified: false,
            };
          },
        },
      ],
    }),
    nextCookies(),
  ],
});
