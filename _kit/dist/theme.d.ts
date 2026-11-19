export declare const THEME_MESSAGE = "lemma-app-theme";
export interface ThemeMessage {
    type: typeof THEME_MESSAGE;
    theme: "light" | "dark";
    density?: string;
    tokens: Record<string, string>;
}
export declare function isThemeMessage(value: unknown): value is ThemeMessage;
export declare function applyTheme(message: ThemeMessage, root?: HTMLElement): void;
/** Listen for the host's theme. Only a framed page has a host to hear. */
export declare function startTheme(): () => void;
