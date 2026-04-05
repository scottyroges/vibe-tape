import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Spotify serves album art from a handful of CDN hosts. `i.scdn.co`
    // covers the overwhelming majority; the others show up for mosaic
    // covers (user-generated playlists) and newer regional URLs.
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com" },
      { protocol: "https", hostname: "image-cdn-fa.spotifycdn.com" },
    ],
  },
};

export default nextConfig;
