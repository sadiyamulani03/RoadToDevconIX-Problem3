import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bhasha Markets — translation verification workbench",
  description:
    "Multilingual (Hindi / Tamil / Marathi) market translation with deterministic invariant verification and a publish gate that blocks any changed number, date, unit or deadline relation.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
