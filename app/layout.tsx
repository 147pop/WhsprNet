import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WhsprNet',
  description: 'Browser-based LoRa messaging interface for ESP devices',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
