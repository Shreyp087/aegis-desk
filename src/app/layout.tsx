import type { Metadata } from "next";
import { JetBrains_Mono, Sora } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

import { AppShell } from "@/components/AppShell";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/context/AuthContext";
import { getServerSession } from "@/lib/auth/session";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Aegis Desk",
  description: "Email triage, AI-assisted analysis, and operational follow-through.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialUser = await getServerSession();

  return (
    <html lang="en" className={`${sora.variable} ${mono.variable}`} suppressHydrationWarning>
      <body
        className="min-h-screen bg-background text-foreground font-sans antialiased"
        suppressHydrationWarning
      >
        <ThemeProvider>
          <AuthProvider initialUser={initialUser}>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
