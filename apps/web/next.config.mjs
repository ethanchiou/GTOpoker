/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export — the trainer is a client-only SPA (spec §4.2). Deployable as files.
  output: 'export',
  reactStrictMode: true,
  // Compile the workspace TS packages (they export source, not built dist).
  transpilePackages: [
    '@gto/domain-config',
    '@gto/hand-eval',
    '@gto/poker-engine',
    '@gto/scoring',
    '@gto/strategy',
  ],
}

export default nextConfig
