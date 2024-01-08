import { useEffect, useState } from "react";

export
  function useLocalStorage(
    key: string,
    initial: string,
    { delayMs }: { delayMs: number },
  ): [string, (newValue: string) => void] {
  const [state, setState] = useState(localStorage.getItem(key) ?? initial);

  useEffect(() => {
    if (localStorage.getItem(key) === null && state === initial) {
      return;
    }

    const save = () => {
      localStorage.setItem(key, state);
    };

    const timeout = setTimeout(save, delayMs);
    return () => {
      clearTimeout(timeout);
    }
  }, [state, key, delayMs]);

  return [state, setState];
}