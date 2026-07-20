"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  // resolvedTheme содержит фактическую тему ("light"/"dark"), в отличие от theme,
  // который при defaultTheme="system" может быть равен "system" и ломать переключение.
  const { resolvedTheme, setTheme } = useTheme();
  // We use mounted state to avoid hydration mismatch
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Return a placeholder of exactly the same size to avoid layout shift
    return <div className="w-10 h-10" />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
      aria-label="Toggle theme"
    >
      {isDark ? (
        <Moon className="w-6 h-6 text-gray-200" />
      ) : (
        <Sun className="w-6 h-6 text-gray-700" />
      )}
    </button>
  );
}
