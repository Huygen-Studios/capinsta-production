/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  ...(process.env.NEXT_OUTPUT === "export" ? { output: "export" } : {}),
};

export default nextConfig;
