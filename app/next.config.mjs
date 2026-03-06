/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["ws", "bufferutil", "utf-8-validate"],
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      os: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
