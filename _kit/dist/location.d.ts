/** Hear the path change from outside: the host's address, or Back on its own. */
export declare function startLocation(): void;
export declare function go(path: string): void;
/** The app's path, and the way to change it. */
export declare function usePath(): [string, (path: string) => void];
/** The record id in `/{id}`, or null on the app's list. */
export declare function useRecordId(): string | null;
export declare function isFramed(): boolean;
/** Not inside an AI tool's conversation, whose frame holds only this app. */
export declare function canOpenApps(): boolean;
/** Open another app of this Lemma at `path` (`/` is its list). */
export declare function openApp(app: string, path?: string): Promise<boolean>;
