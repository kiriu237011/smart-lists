"use client";

import { createContext, useContext, useEffect, useState } from "react";

type SettingsContextType = {
  showAuthors: boolean;
  toggleShowAuthors: () => void;
  showScrollToTop: boolean;
  toggleShowScrollToTop: () => void;
  showItemNumbers: boolean;
  toggleShowItemNumbers: () => void;
  showItemsCounter: boolean;
  toggleShowItemsCounter: () => void;
};

export const SettingsContext = createContext<SettingsContextType>({
  showAuthors: false,
  toggleShowAuthors: () => {},
  showScrollToTop: true,
  toggleShowScrollToTop: () => {},
  showItemNumbers: false,
  toggleShowItemNumbers: () => {},
  showItemsCounter: true,
  toggleShowItemsCounter: () => {},
});

/**
 * Провайдер пользовательских настроек приложения.
 * Хранит состояние в localStorage и предоставляет его через контекст.
 */
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [showAuthors, setShowAuthors] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(true);
  // Нумерация записей выключена по умолчанию: сам порядок хранится всегда,
  // а цифры — опциональное отображение.
  const [showItemNumbers, setShowItemNumbers] = useState(false);
  // Счётчик «выполнено / всего» в шапке карточки включён по умолчанию: он
  // отвечает на первый вопрос к списку — сколько ещё осталось.
  const [showItemsCounter, setShowItemsCounter] = useState(true);

  // Читаем из localStorage только после гидрации, чтобы избежать расхождения SSR/CSR.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowAuthors(localStorage.getItem("showAuthors") === "true");
    setShowScrollToTop(localStorage.getItem("showScrollToTop") !== "false");
    setShowItemNumbers(localStorage.getItem("showItemNumbers") === "true");
    setShowItemsCounter(localStorage.getItem("showItemsCounter") !== "false");
  }, []);

  const toggleShowAuthors = () => {
    setShowAuthors((prev) => {
      const next = !prev;
      localStorage.setItem("showAuthors", String(next));
      return next;
    });
  };

  const toggleShowScrollToTop = () => {
    setShowScrollToTop((prev) => {
      const next = !prev;
      localStorage.setItem("showScrollToTop", String(next));
      return next;
    });
  };

  const toggleShowItemNumbers = () => {
    setShowItemNumbers((prev) => {
      const next = !prev;
      localStorage.setItem("showItemNumbers", String(next));
      return next;
    });
  };

  const toggleShowItemsCounter = () => {
    setShowItemsCounter((prev) => {
      const next = !prev;
      localStorage.setItem("showItemsCounter", String(next));
      return next;
    });
  };

  return (
    <SettingsContext.Provider
      value={{
        showAuthors,
        toggleShowAuthors,
        showScrollToTop,
        toggleShowScrollToTop,
        showItemNumbers,
        toggleShowItemNumbers,
        showItemsCounter,
        toggleShowItemsCounter,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
