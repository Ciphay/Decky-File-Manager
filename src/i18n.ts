import en from "../locales/en.json";
import ptBR from "../locales/pt-BR.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import de from "../locales/de.json";
import zhCN from "../locales/zh-CN.json";

type Dictionary = Record<string, string>;

const translations: Record<string, Dictionary> = {
  en,
  "pt-BR": ptBR,
  es,
  fr,
  de,
  "zh-CN": zhCN,
};

function detectLocale(): string {
  try {
    const steam = (window as any).SteamClient;
    const maybe = steam?.GetCurrentLanguage?.() || steam?.Localization?.GetLanguage?.() || steam?.language || steam?.lang;
    const candidate = (maybe || navigator.language || navigator.languages?.[0] || "en").toString();

    if (/^pt(?:[-_]|$)/i.test(candidate)) return "pt-BR";
    if (/^es(?:[-_]|$)/i.test(candidate)) return "es";
    if (/^zh(?:[-_]|$)/i.test(candidate)) return "zh-CN";
    if (/^fr(?:[-_]|$)/i.test(candidate)) return "fr";
    if (/^de(?:[-_]|$)/i.test(candidate)) return "de";
  } catch {
    // usa o idioma padrão
  }
  return "en";
}

const locale = detectLocale();
const dict: Dictionary = translations[locale] ?? translations.en;

export function t(key: string): string {
  return dict[key] ?? translations.en[key] ?? key;
}

export function tf(key: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), t(key));
}

export function getLocale(): string {
  return locale;
}

export default { t, tf, getLocale };
