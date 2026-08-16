"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSettings } from "@/components/providers/SettingsProvider";
import Tooltip from "@/components/ui/Tooltip";

/**
 * Плавающая кнопка прокрутки наверх.
 * Появляется только после прокрутки более 300px и если включена в настройках.
 */
export default function ScrollToTop() {
  const t = useTranslations("Common");
  const [visible, setVisible] = useState(false);
  const { showScrollToTop } = useSettings();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {/* `key` нужен самому `AnimatePresence`: он собирает детей по ключам, а
          его прямым ребёнком стала обёртка подсказки. Exit-анимация при этом
          остаётся у кнопки — presence доходит до неё контекстом. */}
      {visible && showScrollToTop && (
        <Tooltip key="scroll-to-top" label={t("scrollToTop")}>
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="fixed bottom-6 right-6 z-50 p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-sm hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowUp className="w-5 h-5 text-gray-600 dark:text-zinc-300" />
          </motion.button>
        </Tooltip>
      )}
    </AnimatePresence>
  );
}
