import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'GST invoice extraction with human review (demo)',
  description: 'A demo: a model reads a GST invoice, code validates it, and a person reviews what is flagged before export.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
