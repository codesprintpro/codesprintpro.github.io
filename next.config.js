/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Since this is your user page (username.github.io), we don't need basePath
  basePath: '',
  // This ensures assets are loaded correctly
  assetPrefix: process.env.NODE_ENV === 'production' ? '' : '',
  // This is important for Next.js to know it's a static site
  trailingSlash: true,
}

module.exports = nextConfig 