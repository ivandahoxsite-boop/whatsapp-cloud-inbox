import type { Metadata, Viewport } from "next";
import { QueryProvider } from "@/components/query-provider";
import "./globals.css";

const themeInitScript = `
try {
  const allowedModes = { auto: true, light: true, dark: true, system: true };
  // Until the person picks a mode, the screen is light by day and dark by night (Colombian time).
  const storedMode = window.localStorage.getItem('mode-chosen') === '1' ? window.localStorage.getItem('mode') : 'auto';
  const legacyTheme = window.localStorage.getItem('whatsapp-cloud-inbox-theme');
  const forcedModeAttr = document.documentElement.getAttribute('data-force-mode');
  const forcedMode = forcedModeAttr === 'light' || forcedModeAttr === 'dark' ? forcedModeAttr : null;
  const legacyMode = legacyTheme === 'kapso' ? 'dark' : legacyTheme === 'normal' ? 'light' : null;
  const mode = forcedMode || (allowedModes[storedMode] ? storedMode : legacyMode || 'dark');
  const hour = (new Date().getUTCHours() + 19) % 24;
  const resolvedMode = !forcedMode && mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : !forcedMode && mode === 'auto' ? (hour >= 6 && hour < 18 ? 'light' : 'dark') : mode;

  window.localStorage.setItem('theme', 'default');
  window.localStorage.setItem('mode', mode);
  window.localStorage.removeItem('whatsapp-cloud-inbox-theme');

  document.documentElement.dataset.theme = 'default';
  document.documentElement.dataset.mode = resolvedMode;
  document.documentElement.style.colorScheme = resolvedMode;
  document.documentElement.style.backgroundColor = resolvedMode === 'dark' ? 'hsl(222 24% 7%)' : 'hsl(0 0% 100%)';

  if (resolvedMode === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
} catch {
  document.documentElement.dataset.theme = 'default';
  document.documentElement.dataset.mode = 'dark';
  document.documentElement.classList.add('dark');
}
`;

// After an update the old page asks for code files that no longer exist ("Application error"). Pages are always served
// fresh (never from the browser's cache), and if a code file still fails to load the page reloads itself once.
export const dynamic = 'force-dynamic';

const recoverScript = `
(function () {
  function report(kind, msg) {
    try { navigator.sendBeacon('/api/client-error', JSON.stringify({ kind: kind, msg: String(msg).slice(0, 600), url: location.pathname, ua: navigator.userAgent.slice(0, 120) })); } catch (e) {}
  }
  function isChunk(msg) { return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i.test(String(msg)); }
  function recover(kind, msg) {
    report(kind, msg);
    if (!isChunk(msg)) return;
    try {
      var last = Number(sessionStorage.getItem('crm-reloaded') || 0);
      if (Date.now() - last < 30000) return; // already reloaded just now: do not loop
      sessionStorage.setItem('crm-reloaded', String(Date.now()));
    } catch (e) {}
    location.reload();
  }
  window.addEventListener('error', function (e) { recover('error', (e.error && (e.error.name + ': ' + e.error.message)) || e.message); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; recover('promise', r && (r.name + ': ' + r.message) || r); });
})();
`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "WhatsApp inbox",
  description: "A simple WhatsApp inbox built with Next.js",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: recoverScript }} />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
