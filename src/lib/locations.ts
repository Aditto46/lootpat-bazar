import { useEffect, useState } from "react";
import { apiRequest } from "./api";
import type { Localized } from "./catalog";

export type District = {
  id: string;
  name: Localized;
  division: Localized;
};

type DistrictState = {
  status: "loading" | "ready" | "error";
  districts: District[];
};

let cache: District[] | null = null;
let inflight: Promise<District[]> | null = null;

function loadDistricts(): Promise<District[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = apiRequest<{ districts: District[] }>("/api/locations/districts")
      .then((response) => {
        cache = response.districts;
        inflight = null;
        return cache;
      })
      .catch((cause: unknown) => {
        inflight = null;
        throw cause;
      });
  }
  return inflight;
}

export function useDistricts(): DistrictState {
  const [state, setState] = useState<DistrictState>(() =>
    cache ? { status: "ready", districts: cache } : { status: "loading", districts: [] },
  );

  useEffect(() => {
    if (cache) return;
    let active = true;
    loadDistricts()
      .then((districts) => {
        if (active) setState({ status: "ready", districts });
      })
      .catch(() => {
        if (active) setState({ status: "error", districts: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

const DISTRICT_KEY = "lp-district";

export function readStoredDistrict(): string | null {
  try {
    return window.localStorage.getItem(DISTRICT_KEY);
  } catch {
    return null;
  }
}

export function rememberDistrict(id: string) {
  try {
    window.localStorage.setItem(DISTRICT_KEY, id);
  } catch {
    /* ignore unavailable storage */
  }
}

export function isDhaka(district: District | undefined): boolean {
  return district?.name.en.trim().toLowerCase() === "dhaka";
}

const WEEKLY_HOLIDAY = 5;

function addWorkingDays(from: Date, days: number): Date {
  const next = new Date(from);
  let added = 0;
  while (added < days) {
    next.setDate(next.getDate() + 1);
    if (next.getDay() !== WEEKLY_HOLIDAY) added += 1;
  }
  return next;
}

export function deliveryWindow(dhaka: boolean, from = new Date()): [Date, Date] {
  return dhaka
    ? [addWorkingDays(from, 1), addWorkingDays(from, 1)]
    : [addWorkingDays(from, 2), addWorkingDays(from, 3)];
}

const dateFormatters = {
  bn: new Intl.DateTimeFormat("bn-BD", { day: "numeric", month: "long", weekday: "short" }),
  en: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", weekday: "short" }),
};

export function formatDeliveryDate(date: Date, lang: "bn" | "en"): string {
  return dateFormatters[lang].format(date);
}
