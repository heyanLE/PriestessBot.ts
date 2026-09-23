import { ref } from 'vue';

export type DashboardLanguage = 'zh-CN';

export const dashboardLanguage = ref<DashboardLanguage>('zh-CN');

export function setDashboardLanguage(language: DashboardLanguage) {
  dashboardLanguage.value = language;
  document.documentElement.lang = language;
}

export function toggleDashboardLanguage() {}

export function translate(value: string): string {
  return value;
}

export function applyTranslations(_root: ParentNode = document.body) {}

export function startDashboardI18n(_root: ParentNode = document.body) {
  document.documentElement.lang = 'zh-CN';
  return () => {};
}
