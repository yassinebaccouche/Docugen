import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocuGen — Générateur de documents Word",
  description:
    "Personnalisez vos modèles Word et générez des documents DOCX en quelques clics.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
