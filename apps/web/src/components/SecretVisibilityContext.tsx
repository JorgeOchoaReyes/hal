"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "hal-show-credentials";
const SecretVisibilityContext = createContext<{ visible: boolean; setVisible: (value: boolean) => void }>({
  visible: false,
  setVisible: () => undefined,
});

export default function SecretVisibilityProvider({ children }: { children: ReactNode }) {
  const [visible, updateVisible] = useState(false);

  useEffect(() => {
    try { updateVisible(localStorage.getItem(STORAGE_KEY) === "true"); } catch { /* browser storage may be disabled */ }
  }, []);

  function setVisible(value: boolean) {
    updateVisible(value);
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* keep the in-memory choice */ }
  }

  return <SecretVisibilityContext.Provider value={{ visible, setVisible }}>{children}</SecretVisibilityContext.Provider>;
}

export function useSecretVisibility() {
  return useContext(SecretVisibilityContext);
}
