import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'AIMediaCenter',
  description: 'Automated media library manager, MoviePilot-inspired'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
<html lang="zh-CN" suppressHydrationWarning>
	      <body className="min-h-screen bg-background antialiased" suppressHydrationWarning>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
