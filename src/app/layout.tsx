import type { Metadata } from "next";
import { Commissioner, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/theme-provider";

const commissioner = Commissioner({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-commissioner",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "IO Finance Hub",
  description: "Impact Outsourcing Limited — Internal Finance Operations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full antialiased ${commissioner.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
