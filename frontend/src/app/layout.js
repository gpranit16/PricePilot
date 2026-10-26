import './globals.css';

export const metadata = {
  title: 'PricePilot — Competitor Price Scraper & Dynamic Repricer',
  description: 'A pricing intelligence system for monitoring competitor prices, matching equivalent products, protecting margins, and supporting controlled repricing.',
  keywords: 'pricing intelligence, competitor scraper, dynamic repricer, ecommerce, margin protection',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
