import type { CSSProperties } from 'react';
import { defaultManagementTextSize, type ManagementTextSizeId } from '../shared/management-text-size';

export const managementTextSizes = [
  { id:'small', name:'小', body:14, secondary:12, heading:17, title:24, brand:16, control:36, header:58 },
  { id:'medium', name:'中', body:16, secondary:14, heading:19, title:28, brand:18, control:40, header:64 },
  { id:'large', name:'大', body:18, secondary:16, heading:21, title:32, brand:20, control:44, header:70 },
] as const;

export function managementTextSizeStyle(id:ManagementTextSizeId = defaultManagementTextSize):CSSProperties {
  const size = managementTextSizes.find(size => size.id === id) ?? managementTextSizes[1];
  return Object.fromEntries(Object.entries(size).filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => [`--management-${['control', 'header'].includes(key) ? `${key}-height` : `font-${key}`}`, `${value}px`]));
}
