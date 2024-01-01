import { useEffect, useState } from "react";

export
  function useLocalStorage(
    key: string,
    initial: string,
  ): [string, (newValue: string) => void] {
  const [state, setState] = useState(localStorage.getItem(key) ?? initial);

  useEffect(() => {
    if (localStorage.getItem(key) === null && state === initial) {
      return;
    }
    localStorage.setItem(key, state);
  }, [state, key]);

  return [state, setState];
}