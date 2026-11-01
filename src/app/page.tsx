import { redirect } from 'next/navigation';

// Export of the cartera module: the home page goes straight to the CRM (the original home is the WhatsApp inbox).
export default function Home() {
  redirect('/crm');
}
