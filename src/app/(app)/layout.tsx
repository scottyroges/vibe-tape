import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { SignOutButton } from "./sign-out-button";
import styles from "./layout.module.css";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.logo}>Vibe Tape</span>
        <div className={styles.headerRight}>
          <span className={styles.name}>{session.user.name}</span>
          <SignOutButton />
        </div>
      </header>
      <main className={styles.main} data-scroll-container>{children}</main>
    </div>
  );
}
