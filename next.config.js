/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  basePath: '',
  assetPrefix: '',
  // Transpile ESM-only packages so Next.js webpack can bundle them in getStaticProps
  transpilePackages: ['remark', 'remark-gfm', 'remark-html', 'remark-parse', 'unified', 'bail', 'is-plain-obj', 'trough', 'vfile', 'vfile-message'],
}

module.exports = nextConfig 