/** Root route: redirects to /compose. */

import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/compose'); // /compose sends anonymous users on to /login
}
