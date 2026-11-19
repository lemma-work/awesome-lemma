import { LemmaClient } from "lemma-sdk";
export declare const client: LemmaClient;
/** True when the page knows which Lemma it belongs to. */
export declare function hasLemmaConfig(): boolean;
export interface Me {
    id: string;
    email: string | null;
    name: string | null;
}
/** Who is signed in, read once per page. */
export declare function whoAmI(): Promise<Me | null>;
export declare function orgId(): Promise<string | null>;
