import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Business Analyst Agent",
  description: "Tenant-scoped business metrics and source evidence",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
