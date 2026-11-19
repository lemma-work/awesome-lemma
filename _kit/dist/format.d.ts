export declare function parse(value: string | null | undefined): Date | null;
export declare function daysSince(value: string | null | undefined, now?: number): number | null;
/** "now", "5 min", "3 h", "yesterday", "4 days", "3 wk", "12 Oct". */
export declare function ago(value: string | null | undefined, now?: number): string;
/** "just now", "5 min ago", "yesterday", "4 days ago", "on 12 Oct": ago() for the middle of a sentence. */
export declare function agoText(value: string | null | undefined, now?: number): string;
/** "13 Nov", or "13 Nov 2025" when it is not this year. */
export declare function day(value: string | null | undefined): string;
/** "Today 11:00", "Tomorrow 09:30", "Thu 14:00", "21 Nov 10:00". */
export declare function when(value: string | null | undefined, now?: Date): string;
/** A due date against today: "today", "tomorrow", "by Fri", "2 days late". */
export declare function due(value: string | null | undefined, now?: number): {
    text: string;
    late: boolean;
};
export declare function money(amount: number | null | undefined, currency?: string | null): string;
/** A compact total for a column head: "€48k". */
export declare function moneyShort(amount: number, currency?: string | null): string;
export declare function nameOf(name: string | null | undefined, email?: string | null): string;
export declare function firstName(name: string | null | undefined, email?: string | null): string;
export declare function initials(name: string | null | undefined, email?: string | null): string;
/** A stable, muted colour for a person or company, from their address. */
export declare function tint(seed: string | null | undefined): string;
/** A stable hue (0-359) for a person or company, from their address: the
 *  avatar and the company mark tint by it, light or dark. */
export declare function hue(seed: string | null | undefined): number;
export declare function plural(count: number, one: string, many?: string): string;
export declare function domainOf(email: string | null | undefined): string;
