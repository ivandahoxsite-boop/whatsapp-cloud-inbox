'use client';

import { ErrorScreen } from '@/components/error-screen';

// Replaces the whole page when even the root layout fails, so it brings its own <html> and <body>.
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body>
        <ErrorScreen {...props} />
      </body>
    </html>
  );
}
