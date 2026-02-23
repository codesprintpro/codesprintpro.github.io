/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://codesprintpro.com',
  generateRobotsTxt: true,
  trailingSlash: true,
  outDir: './out',
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    additionalSitemaps: [
      'https://codesprintpro.com/sitemap.xml',
    ],
  },
}
