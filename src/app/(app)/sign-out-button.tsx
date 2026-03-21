"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import styles from "./sign-out-button.module.css";

export function SignOutButton() {
  const router = useRouter();

  async function handleClick() {
    try {
      const result = await authClient.signOut();

      if (result.error) {
        console.error("Sign-out error:", result.error);
      }
    } catch (err: unknown) {
      console.error("Sign-out error:", err);
    } finally {
      router.push("/login");
    }
  }

  return (
    <button className={styles.button} onClick={handleClick}>
      Sign out
    </button>
  );
}
