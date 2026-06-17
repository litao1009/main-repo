import type { NextConfig } from "next";
import { resolveAllowedDevOrigins } from "./next.dev-origins";

const nextConfig: NextConfig = {
  // 开发模式下隐藏右下角 Next.js Dev Indicator（N 按钮）
  devIndicators: false,
  // 自动收集本机/云实例 IP；也可通过 ALLOWED_DEV_ORIGINS=1.2.3.4,example.com 补充
  allowedDevOrigins: resolveAllowedDevOrigins(),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8088/api/:path*",
      },
      {
        source: "/ws/:path*",
        destination: "http://127.0.0.1:8088/ws/:path*",
      },
    ];
  },
};

export default nextConfig;
