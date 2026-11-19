// Where an app is, and opening another app of the same Lemma.
//
// The SDK does both (`moveAppTo`, `watchAppPath`, `openApp`). Framed, the app
// tells the Lemma around it where it moved, follows it when its address
// changes, and asks it to open another app. On its own in a tab, the path is
// the page's own, pushed and popped like any page's, and another app is opened
// by going to that app's address, which the API knows. In a demo the path is
// the page's #fragment, and opening another app goes to that app's demo.

import { useSyncExternalStore } from "react";
import { currentAppPath, isEmbeddedInHost, isFramedByHost, moveAppTo, watchAppPath } from "lemma-sdk";
import { client } from "./client";
import { DEMO, demoMove, demoPath, demoWatchPath } from "./demo";

let current = typeof window === "undefined" ? "/" : DEMO ? demoPath() : currentAppPath();
const listeners = new Set<() => void>();
let watching = false;

const tell = () => {
  for (const listener of [...listeners]) listener();
};

/** Hear the path change from outside: the host's address, or Back on its own. */
export function startLocation(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  (DEMO ? demoWatchPath : watchAppPath)((path) => {
    if (path === current) return;
    current = path;
    tell();
  });
}

const subscribe = (listener: () => void) => {
  startLocation();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getPath = () => current;

export function go(path: string): void {
  const next = DEMO ? demoMove(path) : moveAppTo(path);
  if (next === null || next === current) return;
  current = next;
  tell();
  if (!DEMO) window.scrollTo({ top: 0 });
}

/** The app's path, and the way to change it. */
export function usePath(): [string, (path: string) => void] {
  const path = useSyncExternalStore(subscribe, getPath, getPath);
  return [path, go];
}

/** The record id in `/{id}`, or null on the app's list. */
export function useRecordId(): string | null {
  const [path] = usePath();
  const id = path.split("/").filter(Boolean)[0];
  return id ? decodeURIComponent(id) : null;
}

export function isFramed(): boolean {
  // A demo's frame is a web page, not a Lemma: nothing there hears an app.
  return !DEMO && isFramedByHost();
}

/** Not inside an AI tool's conversation, whose frame holds only this app. */
export function canOpenApps(): boolean {
  return typeof window !== "undefined" && (DEMO || !isEmbeddedInHost());
}

/** Open another app of this Lemma at `path` (`/` is its list). */
export function openApp(app: string, path = "/"): Promise<boolean> {
  if (!canOpenApps()) return Promise.resolve(false);
  return client.apps.open(app, path);
}
