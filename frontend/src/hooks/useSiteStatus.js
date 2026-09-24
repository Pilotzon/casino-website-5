import { useEffect, useState } from "react";
import api from "../services/api";

const DEFAULT = { signup_enabled: true, maintenance_mode: false };
let cache = null;
const listeners = new Set();

async function load() {
  try {
    const res = await api.get("/pages/status");
    cache = { ...DEFAULT, ...(res.data?.data ?? {}) };
  } catch {
    cache = cache ?? DEFAULT;
  }
  listeners.forEach((fn) => fn(cache));
}

/* Public site switches (sign-up on/off, maintenance mode). Shared cache,
   refreshed on mount and every 30s so admin toggles show up quickly. */
export default function useSiteStatus() {
  const [status, setStatus] = useState(cache ?? DEFAULT);
  useEffect(() => {
    listeners.add(setStatus);
    if (!cache) load();
    else setStatus(cache);
    const id = setInterval(load, 30000);
    return () => {
      listeners.delete(setStatus);
      clearInterval(id);
    };
  }, []);
  return status;
}

export const refreshSiteStatus = load;
