/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Add trailing slash to ensure proper routing
  trailingSlash: true,
  // Remove comments and enable these lines
  basePath: '',
  assetPrefix: ''
}

module.exports = nextConfig 