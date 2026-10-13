import type { NextConfig } from 'next';
const config: NextConfig = { output: 'export', trailingSlash: true, images: { unoptimized: true }, experimental: { useTypeScriptCli: false }, turbopack: { root: process.cwd() } };
export default config;
