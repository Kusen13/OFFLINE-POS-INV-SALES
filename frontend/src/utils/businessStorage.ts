/**
 * Business Department Management (Dynamic + Offline-ready)
 * 
 * Supports user-created custom business departments (e.g. Cafe, Bakery, Meat Shop)
 * combined with the default base departments.
 */

import { BUSINESS_DEPARTMENTS as DEFAULT_DEPARTMENTS, type BusinessDepartment } from '../types/product';

const STORAGE_KEY = 'pos_custom_business_departments_v1';

export function getAllBusinessDepartments(): BusinessDepartment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DEPARTMENTS;
    const custom: BusinessDepartment[] = JSON.parse(raw);
    
    // Combine base departments with any user-added custom ones
    const map = new Map<string, BusinessDepartment>();
    for (const d of DEFAULT_DEPARTMENTS) {
      map.set(d.id, d);
    }
    for (const c of custom) {
      map.set(c.id, c);
    }
    return Array.from(map.values());
  } catch (err) {
    console.error('Failed to load custom business departments:', err);
    return DEFAULT_DEPARTMENTS;
  }
}

export function saveCustomBusinessDepartment(dept: BusinessDepartment): BusinessDepartment[] {
  try {
    const currentCustom = getCustomOnlyDepartments();
    const updated = [...currentCustom.filter(d => d.id !== dept.id), dept];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('pos_departments_updated', { detail: dept }));
    return getAllBusinessDepartments();
  } catch (err) {
    console.error('Failed to save business department:', err);
    return getAllBusinessDepartments();
  }
}

export function deleteCustomBusinessDepartment(id: string): BusinessDepartment[] {
  try {
    const currentCustom = getCustomOnlyDepartments();
    const updated = currentCustom.filter(d => d.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('pos_departments_updated', { detail: { id, deleted: true } }));
    return getAllBusinessDepartments();
  } catch (err) {
    console.error('Failed to delete business department:', err);
    return getAllBusinessDepartments();
  }
}

function getCustomOnlyDepartments(): BusinessDepartment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getDepartmentTheme(_color?: string) {
  return {
    badgeBg: 'bg-surface-800 text-surface-200 border-surface-700/60',
    activeColor: 'bg-primary-600 text-white border-primary-500 shadow-sm',
  };
}
