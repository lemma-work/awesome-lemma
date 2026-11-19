import { jsx as _jsx } from "react/jsx-runtime";
// "Ask": offers a question to the chat box of the Lemma around the app.
//
// The offering is the SDK's `composeInConversation`, and whether there is
// anyone to offer it to is `canComposeInConversation`. Both live on the SDK's
// browser bundle, loaded as its own chunk only when the page is framed. Nothing
// is sent: the host puts the text in its box and the person decides.
import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { isFramed } from "./location";
import { Button, useToast } from "./ui";
let loading = null;
function loadBrowserSdk() {
    if (!isFramed())
        return Promise.resolve(null);
    if (!loading) {
        loading = import("lemma-sdk/browser-bundle")
            .then(() => window.LemmaClient ?? null)
            .catch(() => null);
    }
    return loading;
}
export function useAsk() {
    const [sdk, setSdk] = useState(null);
    useEffect(() => {
        let live = true;
        void loadBrowserSdk().then((loaded) => {
            if (live && loaded?.composeInConversation && loaded.canComposeInConversation?.())
                setSdk(loaded);
        });
        return () => {
            live = false;
        };
    }, []);
    const compose = sdk?.composeInConversation;
    return compose ? (text) => compose(text) : null;
}
/** Draws nothing on its own in a tab, where there is no chat box to offer to. */
export function AskButton({ text, label = "Ask" }) {
    const ask = useAsk();
    const toast = useToast();
    if (!ask)
        return null;
    return (_jsx(Button, { icon: MessageCircle, title: "Put a question about this in the Lemma's chat box", onClick: () => void ask(text).then((took) => took && toast("It's in the chat box. Nothing is sent until you send it.")), children: label }));
}
