import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Portal de planificación · Centro Falguera",
  description:
    "Acceso privado ás planificacións de adestramento e readaptación.",
  robots: {
    index: false,
    follow: false,
  },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: [
      {
        url: "/centro-falguera-isotipo.png?v=20260806-2",
        type: "image/png",
        sizes: "259x259",
      },
    ],
    shortcut: "/centro-falguera-isotipo.png?v=20260806-2",
    apple: "/centro-falguera-isotipo.png?v=20260806-2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="gl">
      <head>
        <link
          rel="icon"
          type="image/png"
          sizes="259x259"
          href="/centro-falguera-isotipo.png?v=20260806-2"
        />
        <link
          rel="shortcut icon"
          href="/centro-falguera-isotipo.png?v=20260806-2"
        />
        <link
          rel="apple-touch-icon"
          href="/centro-falguera-isotipo.png?v=20260806-2"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
