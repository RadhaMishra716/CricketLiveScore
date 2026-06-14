import "./globals.css";

export const metadata = {
  title: "Cricket Live Score",
  description: "Live cricket match scores",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
