"use client";
import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { translate, type Key, type Lang } from "@/lib/i18n";

const LangContext = createContext<Lang>("pt");

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return <LangContext value={lang}>{children}</LangContext>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

export type T = (key: Key, params?: Record<string, string | number>) => string;

export function useT(): T {
  const lang = useLang();
  return useCallback<T>((key, params) => translate(lang, key, params), [lang]);
}
