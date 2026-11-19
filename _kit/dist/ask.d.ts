export declare function useAsk(): ((text: string) => Promise<boolean>) | null;
/** Draws nothing on its own in a tab, where there is no chat box to offer to. */
export declare function AskButton({ text, label }: {
    text: string;
    label?: string;
}): import("react").JSX.Element | null;
