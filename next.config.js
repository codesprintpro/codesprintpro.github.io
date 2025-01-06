/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Remove basePath and assetPrefix if this is your main site
  // basePath: '',
  // assetPrefix: '',
}

module.exports = nextConfig 