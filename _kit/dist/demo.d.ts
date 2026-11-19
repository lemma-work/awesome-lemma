export declare const DEMO: boolean;
/** Where the demo client sends its calls. `.invalid` never resolves, so a call this file failed to answer could not reach anything either. */
export declare const DEMO_API = "https://lemma-demo.invalid";
export interface DemoApp {
    /** The app's name in its plugin, as `client.apps.open` names it. */
    name: string;
    label: string;
    /** Its demo page, relative to this one. */
    href: string;
}
export interface DemoData {
    plugin: string;
    /** This page's app. */
    app: string;
    /** Every app of the plugin that has a demo; the bar switches between them. */
    apps: DemoApp[];
    /** Where the app opens when the address names nowhere. */
    start?: string;
    /** Request path under the API (no `.json`) -> answer, as in shots/fixtures. */
    fixtures: Record<string, unknown>;
    /** Pod file path (or a document's file name) -> its text. */
    files?: Record<string, string>;
    /** Function or workflow name -> the note shown when it runs. */
    notes?: Record<string, string>;
    /**
     * The day the sample was written for (`2026-11-18`). Its dates move by whole
     * days so that day is today. With a time (`2026-11-18T13:30:00Z`, the moment
     * it was written), a viewer earlier in their day than that gets it as of
     * yesterday instead, so nothing it wrote reads as future.
     */
    anchor?: string;
    /**
     * The zone the sample was written in (or its names: `["Asia/Kolkata", "Asia/Calcutta"]`).
     * Its times move so their clock readings are the same in the viewer's zone,
     * and those names in the sample become the viewer's zone.
     */
    zone?: string | string[];
    /** App name -> its name on screen, for the apps of every plugin (the note for an app not in the demo names it). */
    labels?: Record<string, string>;
    /** The sample person who is signed in. */
    user?: Record<string, unknown>;
    /** Google Fonts family, in lower case -> stylesheet beside the page with that face in it. */
    fonts?: Record<string, string>;
}
type Row = Record<string, unknown>;
/** What a plugin's `.lemma/demo.js` handlers get to change the sample with. */
export interface DemoDb {
    /** Merge `fields` into the rows with these ids, wherever a read returns them. */
    patch(ids: string | string[], fields: Row, table?: string): void;
    /** Take these rows out of every read. */
    remove(ids: string | string[], table?: string): void;
    /** A new row of `table`, returned by later reads of that table. */
    add(table: string, row: Row): Row;
    /** A row as the sample has it now (with every change), or null; `table` narrows which changes apply. */
    find(id: string, table?: string): Row | null;
    /** The rows of the datastore query fixture whose `match` contains `text`; with `table`, rows added to it too. */
    rows(text: string, table?: string): Row[];
    /** Write a pod file's text, which later downloads of that path return. */
    file(path: string, text: string): void;
    /** A fixture's answer, by request path. */
    fixture(path: string): unknown;
    /** Show a short line at the bottom of the page. */
    note(text: string): void;
    /** Tell the app's change stream that `table` changed, so it reads again. */
    changed(table: string, id?: string): void;
}
export type DemoHandler = (input: Row, db: DemoDb, context: {
    method: string;
    path: string;
}) => unknown;
declare global {
    interface Window {
        __LEMMA_DEMO__?: DemoData;
        /** Function or workflow name (or `METHOD path` regex source) -> handler, from the plugin's `.lemma/demo.js`. */
        __LEMMA_DEMO_HANDLERS__?: Record<string, DemoHandler>;
        /** The in-memory sample, once the demo is on, for a plugin's demo.js. */
        __LEMMA_DEMO_DB__?: DemoDb;
    }
}
/** The sample data, once the demo is on. */
export declare function demoData(): DemoData;
export declare function demoPath(): string;
/** Move inside the app. Its own step in the frame's history, so the app's Back goes back inside it. */
export declare function demoMove(next: string): string | null;
export declare function demoWatchPath(listener: (path: string) => void): () => void;
/** Open an app of this plugin at `path`; any other app gets a note. */
export declare function demoOpenApp(app: string, at?: string): Promise<boolean>;
/** A short line at the bottom of the page, in the kit's toast. */
export declare function demoNote(text: string): void;
/** Turn the demo on and say how the client should be made. Once per page, before the client. */
export declare function startDemo(): {
    apiUrl: string;
    authUrl: string;
    podId: string;
    token: string;
    app: {
        name: string;
    };
};
/** The client's change stream and app opening, answered here. */
export declare function wireDemo(client: unknown): void;
export {};
