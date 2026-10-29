import type { CSSProperties } from 'react';
import { defaultManagementTheme, type ManagementThemeId } from '../shared/management-theme';

const darkStatus = { success: '#b7e2cf', warning: '#f5ca87', error: '#ffb5c0', successSurface: '#203a36', warningSurface: '#423521', errorSurface: '#432831' };
const lightStatus = { success: '#226646', warning: '#875400', error: '#b52c45', successSurface: '#e0f1e7', warningSurface: '#f8edcf', errorSurface: '#f9e3e8' };
export const managementThemes = [
  { id: 'graphite', name: 'グラファイト', description: '墨色 × シルバー', scheme: 'dark', background: '#141619', surface: '#292e35', panel: '#363d46', input: '#141619', line: '#758291', text: '#f6f8fc', muted: '#d5dfe9', accent: '#dae2ef', accentText: '#20252e', soft: '#38424f', ...darkStatus },
  { id: 'midnight', name: 'ミッドナイト', description: 'ネイビー × ブルー', scheme: 'dark', background: '#101b2a', surface: '#24394f', panel: '#2d465f', input: '#101b2a', line: '#728da9', text: '#f2f6fd', muted: '#ccdcee', accent: '#aacfff', accentText: '#182739', soft: '#294663', ...darkStatus },
  { id: 'ocean', name: 'オーシャン', description: 'ブルーグレー × ミント', scheme: 'dark', background: '#122029', surface: '#203640', panel: '#29434e', input: '#122029', line: '#607e8b', text: '#f0f7fa', muted: '#c8d9e2', accent: '#9be2cf', accentText: '#16372f', soft: '#24493f', ...darkStatus, success: '#c0eedc', warning: '#ffd18b' },
  { id: 'burgundy', name: 'バーガンディ', description: 'ワイン色 × ローズ', scheme: 'dark', background: '#21151c', surface: '#3d2934', panel: '#4e3442', input: '#21151c', line: '#a2768c', text: '#fff1f7', muted: '#e9cbd9', accent: '#ffbbd1', accentText: '#3a1d29', soft: '#503644', ...darkStatus },
  { id: 'pearl', name: 'パール', description: 'オフホワイト × ブルー', scheme: 'light', background: '#dbe2ed', surface: '#ffffff', panel: '#e6edf7', input: '#ffffff', line: '#7a879b', text: '#1a2638', muted: '#36455d', accent: '#244f88', accentText: '#ffffff', soft: '#dce7f7', ...lightStatus },
  { id: 'ivory', name: 'アイボリー', description: '生成り × アンバー', scheme: 'light', background: '#e8dcc9', surface: '#fffcf6', panel: '#f3e6d1', input: '#fffcf6', line: '#9f8766', text: '#322617', muted: '#55432e', accent: '#78490f', accentText: '#ffffff', soft: '#ecdab8', ...lightStatus },
  { id: 'sakura', name: 'サクラ', description: '淡いピンク × ローズ', scheme: 'light', background: '#ead6de', surface: '#fffafb', panel: '#f5e3ea', input: '#fffafb', line: '#ac7d91', text: '#3d2631', muted: '#614152', accent: '#8e3658', accentText: '#ffffff', soft: '#efd6e0', ...lightStatus },
  { id: 'lavender', name: 'ラベンダー', description: '淡い紫 × バイオレット', scheme: 'light', background: '#ded6ed', surface: '#fcfaff', panel: '#ece5f6', input: '#fcfaff', line: '#9580af', text: '#2b1f40', muted: '#4e3b67', accent: '#604093', accentText: '#ffffff', soft: '#e2d6f0', ...lightStatus },
] as const;

export function managementThemeStyle(id: ManagementThemeId = defaultManagementTheme): CSSProperties {
  const theme = managementThemes.find(theme => theme.id === id) ?? managementThemes[2];
  const style: Record<string, string> = { colorScheme: theme.scheme };
  for (const key of ['background', 'surface', 'panel', 'input', 'line', 'text', 'muted', 'accent', 'accentText', 'soft', 'success', 'warning', 'error', 'successSurface', 'warningSurface', 'errorSurface'] as const) {
    style[`--studio-${key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}`] = theme[key];
  }
  return style;
}
