# Sachin Sarawgi's Portfolio

A modern, responsive portfolio website built with Next.js, TypeScript, and TailwindCSS. This portfolio showcases my professional experience, technical skills, projects, and blog posts.

## 🚀 Features

- Responsive design that works on all devices
- Smooth animations using Framer Motion
- Static export with Next.js
- Type-safe development with TypeScript
- Modern styling with TailwindCSS
- Contact form with Supabase integration
- File-backed blog powered by Markdown posts
- Portfolio section showcasing projects
- Accessibility features
- Mobile-friendly navigation
- Custom 404 page
- SEO optimized
- Progressive Web App (PWA) support

## 🛠️ Tech Stack

- **Framework**: Next.js 15
- **Language**: TypeScript
- **Styling**: TailwindCSS
- **Animations**: Framer Motion
- **Database**: Supabase
- **Icons**: Font Awesome
- **Font**: Inter (Google Fonts)
- **Development Tools**: TypeScript
- **Deployment**: GitHub Pages

## 💻 Development

### Prerequisites

- Node.js 18 or later
- npm or yarn
- Supabase account for contact form and newsletter signup

### Environment Variables

Create a `.env.local` file in the root directory. Use `.env.example` as the
template:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

For GitHub Pages deployments, add the same values as repository secrets named
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The deploy
workflow validates that these values are present and that the Supabase project
hostname resolves before building the static site.

If you want Google Analytics 4 tracking, also add
`NEXT_PUBLIC_GA_MEASUREMENT_ID`. This is the GA4 web data stream identifier and
usually starts with `G-`.

### Supabase Tables

The contact form writes to `contact_messages`. Newsletter signup writes to
`newsletter_subscribers`; run `supabase/contact-messages.sql` and
`supabase/newsletter-subscribers.sql` in the Supabase SQL editor so form
submissions and reader signups can be stored.

### Code Style

- Follow TypeScript best practices
- Use functional components with hooks
- Implement proper TypeScript types
- Follow accessibility guidelines
- Use semantic HTML elements

### Available Scripts

- `npm run dev`: Start development server
- `npm run build`: Build for production
- `npm run start`: Start production server
- `npm run lint`: Configure/run Next.js linting if ESLint has been set up
- `npx tsc --noEmit`: Run TypeScript compiler

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📧 Contact

Sachin Sarawgi - sachinsarawgi201143@gmail.com

Project Link: [https://github.com/codesprintpro/portfolio](https://github.com/codesprintpro/portfolio)

## 🙏 Acknowledgments

- [Next.js Documentation](https://nextjs.org/docs)
- [TailwindCSS](https://tailwindcss.com)
- [Framer Motion](https://www.framer.com/motion)
- [Font Awesome](https://fontawesome.com)
- [Google Fonts](https://fonts.google.com)

## 🔍 SEO

The portfolio is optimized for search engines with:
- Semantic HTML
- Meta tags
- Structured data
- Sitemap
- Robots.txt
- Fast loading times
- Mobile responsiveness

## 🔒 Security

- All external links use `rel="noopener noreferrer"`
- Form validation and sanitization
- Secure headers
