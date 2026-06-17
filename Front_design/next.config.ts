import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 开发模式下隐藏右下角 Next.js Dev Indicator（N 按钮）
  devIndicators: false,
  allowedDevOrigins: ["47.107.124.45"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8088/api/:path*",
      },
    ];
  },
};

export default nextConfig;
