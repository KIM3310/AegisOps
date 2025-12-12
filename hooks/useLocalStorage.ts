import { useState, useCallback } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      const val = v instanceof Function ? v(value) : v;
      setValue(val);
      localStorage.setItem(key, JSON.stringify(val));
    },
    [key, value]
  );

  return [value, set];
}
