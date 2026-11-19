import { type ReactNode } from "react";
export interface Loader {
    /** Read with SQL; RLS scopes every table to the signed-in person's own rows. */
    sql?: string;
    /** Or anything else that returns rows. */
    load?: () => Promise<unknown>;
    /** Which tables' changes make this stale. */
    tables: string[];
}
export type Loaders = Record<string, Loader>;
export declare function items<T>(response: unknown): T[];
export declare function q<T>(sql: string): Promise<T[]>;
export declare function sql(value: unknown): string;
export declare function update(table: string, id: string, data: Record<string, unknown>): Promise<void>;
export declare function create<T = Record<string, unknown>>(table: string, data: Record<string, unknown>): Promise<T>;
/** A function run's output, whichever shape the API hands back. */
export declare function runFunction<T = Record<string, unknown>>(name: string, input?: Record<string, unknown>): Promise<T>;
export declare function startWorkflow(name: string): Promise<string | undefined>;
interface Ctx {
    data: Record<string, unknown>;
    loaded: boolean;
    errors: Record<string, string | undefined>;
    reload: (name?: string) => Promise<void>;
}
export declare function DataProvider({ loaders, children }: {
    loaders: Loaders;
    children: ReactNode;
}): import("react").JSX.Element;
export declare function useData(): Ctx;
/** One named result as rows. */
export declare function useRows<T>(name: string): T[];
export {};
