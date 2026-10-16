import './globals.css';
export const metadata = {
  title: 'Vectra Assure · Vectra Solutions',
  description: 'Evidence management, beneficiary verification and project readiness by Vectra Solutions',
  icons: { icon: { url: '/brand/vectra-assure-icon.png', type: 'image/png' }, apple: '/brand/vectra-assure-icon.png' },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
