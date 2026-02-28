// https://blog.logrocket.com/authentication-react-router-v6/
// To maintain the user’s state even after a page refresh, we create the useLocalStorage Hook, which synchronizes the state value with the browser’s local storage:

// 1.5.21 EDIT: useSyncExternalStore is the recommended way in 2025 to synchronize React state with external stores like localStorage. 
// It ensures your UI stays consistent across multiple browser tabs by subscribing to the global storage event
// you do not need useState if you are using the useSyncExternalStore implementation for localStorage.
// one of the primary reasons to use useSyncExternalStore in 2025 is to remove useState and useEffect duplication.

import { useSyncExternalStore, useRef } from 'react';

/**
 * Custom hook to sync state with localStorage across tabs.
 * @param {string} key - The localStorage key to track.
 * @param {any} initialValue - Default value if key is missing.
 */
// Using null as a default for initialValue makes code harder to work with because "null checks" are needed everywhere
// function useLocalStorage(key, initialValue) {
export const useLocalStorage = (key, initialValue) => {
  // 0. Use a Ref to cache the parsed value and the raw string for comparison
  const cache = useRef({ raw: null, parsed: initialValue });

  // 1. Snapshot for the browser
  // Only check window here to be extra safe, though getSnapshot 
  // is typically only called on the client.
  const getSnapshot = () => {
    if (typeof window === 'undefined') return initialValue;
    
    const raw = localStorage.getItem(key) || initialValue;   // returns null when not exist so let's use initialValue instead
    
    // Check if the raw string changed before parsing
    if (key == 'containerName') console.debug(`${key}.raw: ${JSON.stringify(cache.current.raw)} == ${JSON.stringify(raw)}`);
    if (cache.current.raw !== raw) {
      cache.current.raw = raw;
      try {
        // If null (key missing), use initialValue; otherwise parse
        cache.current.parsed = (raw !== null) ? JSON.parse(raw) : initialValue;
      
      // catch any parsing error, and they WILL happen; for instance, even though raw is null when key does not exist, its value is still undefined when the if test happens. No idea why.
      } catch (error) {
        cache.current.parsed = initialValue;
      }
    }
    
    return cache.current.parsed;
  };

  // 2. Snapshot for the server (SSR)
  // This prevents the "window is not defined" error during build/render
  const getServerSnapshot = () => initialValue;

  // 3. Subscribe to changes
  const subscribe = (callback) => {
    window.addEventListener('storage', callback);
    return () => window.removeEventListener('storage', callback);
  };

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setState = (newValue) => {
    if (typeof window !== 'undefined') {
      // "Boolean-Safe" Hook for storing false values
      // localStorage.setItem(key, JSON.stringify(newValue));
      const valueToStore = newValue instanceof Function ? newValue(state) : newValue;
      localStorage.setItem(key, JSON.stringify(valueToStore));

      // Manually notify this tab since the storage event only fires on other tabs
      window.dispatchEvent(new Event('storage'));
    }
  };

  return [state, setState];
}