import { execSync } from "node:child_process";
import os from "node:os";

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isIPv4(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function addIPv4(origins: Set<string>, value: string | undefined | null) {
  const ip = value?.trim();
  if (ip && IPV4_RE.test(ip)) origins.add(ip);
}

function getLocalIPv4Addresses(): string[] {
  const origins = new Set<string>();

  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (isIPv4(net.family) && !net.internal) {
        addIPv4(origins, net.address);
      }
    }
  }

  return [...origins];
}

function tryFetchMetadataIPv4(url: string): string | null {
  try {
    const output = execSync(`curl -fsS --connect-timeout 1 --max-time 2 ${url}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return IPV4_RE.test(output) ? output : null;
  } catch {
    return null;
  }
}

/** 尝试从常见云厂商 metadata 读取公网 IPv4（无则忽略） */
function getCloudPublicIPv4Addresses(): string[] {
  const origins = new Set<string>();

  for (const url of [
    "http://100.100.100.200/latest/meta-data/eipv4", // 阿里云
    "http://169.254.169.254/latest/meta-data/public-ipv4", // AWS 等
  ]) {
    addIPv4(origins, tryFetchMetadataIPv4(url));
  }

  return [...origins];
}

function getEnvDevOrigins(): string[] {
  const raw = process.env.ALLOWED_DEV_ORIGINS?.trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** next dev 允许的额外 Origin：本机网卡 IP + 云 metadata 公网 IP + 环境变量 */
export function resolveAllowedDevOrigins(): string[] {
  const origins = new Set<string>([
    ...getLocalIPv4Addresses(),
    ...getCloudPublicIPv4Addresses(),
    ...getEnvDevOrigins(),
  ]);

  return [...origins];
}
