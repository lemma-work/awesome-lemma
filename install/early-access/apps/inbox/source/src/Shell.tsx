// The mail client: what you need to do on the left, the list in the middle,
// the conversation on the right. Below 860px one pane at a time, with the left
// side as a drawer.

import { useEffect, useState } from "react";
import {
  Archive, BellOff, CircleHelp, Clock, EyeOff, Handshake, Hourglass, Inbox as InboxIcon, Loader2, Menu, Reply, Settings as Cog, X,
  type LucideIcon,
} from "lucide-react";
import { Avatar, Banner, Button, cx } from "@lemma-plugins/kit";
import { stoppedText } from "./connection";
import { isSample, useMail } from "./data";
import { List } from "./List";
import { Promises } from "./Promises";
import { SettingsPage } from "./Settings";
import { to, useRoute, type View } from "./route";

const NAV: { view: View; label: string; icon: LucideIcon; hot?: boolean }[] = [
  { view: "needs", label: "Needs reply", icon: Reply, hot: true },
  { view: "inbox", label: "Inbox", icon: InboxIcon },
  { view: "waiting", label: "Waiting on others", icon: Hourglass },
  { view: "unsure", label: "Not sure", icon: CircleHelp, hot: true },
];
const LATER: { view: View; label: string; icon: LucideIcon }[] = [
  { view: "snoozed", label: "Snoozed", icon: Clock },
  { view: "aside", label: "Set aside", icon: EyeOff },
  { view: "done", label: "Done", icon: Archive },
];

function Nav({ onPick }: { onPick: () => void }) {
  const route = useRoute();
  const { counts, mailboxes, promises, settings } = useMail();
  const here = (v: View) => route.page === "list" && route.view === v;
  const pick = (fn: () => void) => () => {
    fn();
    onPick();
  };
  const sorting = counts.view.sorting || 0;
  return (
    <nav className="m-nav" aria-label="Mail">
      <div className="m-nav__brand">
        <span className="c-header__icon" aria-hidden="true"><InboxIcon size={15} /></span>
        <span>Inbox</span>
      </div>
      <div className="c-nav">
        {NAV.map((n) => (
          <button key={n.view} type="button" className="c-nav__item" aria-current={here(n.view) ? "page" : undefined} onClick={pick(() => to.list(n.view))}>
            <n.icon aria-hidden="true" />
            {n.label}
            <span className={cx("c-nav__n", n.hot && "c-nav__n--hot")}>{counts.view[n.view] || ""}</span>
          </button>
        ))}
        <button type="button" className="c-nav__item" aria-current={route.page === "promises" ? "page" : undefined} onClick={pick(() => to.promises())}>
          <Handshake aria-hidden="true" />
          Promises
          <span className="c-nav__n">{promises.length || ""}</span>
        </button>
        {sorting ? (
          <button type="button" className="c-nav__item" aria-current={here("sorting") ? "page" : undefined} onClick={pick(() => to.list("sorting"))}>
            <Loader2 aria-hidden="true" className="m-spin" />
            Being sorted
            <span className="c-nav__n">{sorting}</span>
          </button>
        ) : null}
        <p className="c-nav__label">Later</p>
        {LATER.map((n) => (
          <button key={n.view} type="button" className="c-nav__item" aria-current={here(n.view) ? "page" : undefined} onClick={pick(() => to.list(n.view))}>
            <n.icon aria-hidden="true" />
            {n.label}
            <span className="c-nav__n">{counts.view[n.view] || ""}</span>
          </button>
        ))}
        <p className="c-nav__label">Yours</p>
        <button type="button" className="c-nav__item" aria-current={route.page === "settings" ? "page" : undefined} onClick={pick(() => to.settings())}>
          <Cog aria-hidden="true" />
          Categories and settings
        </button>
      </div>
      <div className="m-nav__foot">
        {mailboxes.map((m) => (
          <div key={m.id} className="m-nav__box" title={m.last_error ? stoppedText(m.last_error, m.provider) : undefined}>
            <Avatar name={settings?.display_name} email={m.email} size={22} you />
            <span className="c-ellipsis">{m.account_id === "sample" ? "Sample mailbox" : m.email}</span>
            {m.last_error ? <BellOff size={13} aria-label="Reading stopped" /> : null}
          </div>
        ))}
      </div>
    </nav>
  );
}

export function Shell() {
  const route = useRoute();
  const { errors, reload, mailboxes } = useMail();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route.page]);
  const errs = Object.entries(errors).filter(([, v]) => v);
  const sample = isSample(mailboxes);
  return (
    <div className={cx("m-shell", open && "is-nav-open")}>
      <aside className="m-side">
        <Nav onPick={() => setOpen(false)} />
      </aside>
      {open ? <button type="button" className="m-scrim" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <main className="m-main">
        <div className="m-mobilebar">
          <Button variant="ghost" icon={open ? X : Menu} label={open ? "Close menu" : "Menu"} onClick={() => setOpen((v) => !v)} />
          <span className="m-mobilebar__title">Inbox</span>
        </div>
        {sample ? (
          <div className="m-strip">
            <Banner action={<Button size="sm" onClick={() => to.settings("mailboxes")}>Connect my mail</Button>}>
              <b>Sample mailbox.</b> Made-up mail at .example addresses; nothing can be sent from it.
            </Banner>
          </div>
        ) : null}
        {errs.length ? (
          <div className="m-strip">
            {errs.map(([name, text]) => (
              <Banner key={name} tone="danger" action={<Button size="sm" onClick={() => void reload(name as never)}>Try again</Button>}>
                Couldn’t load {name}: {text}
              </Banner>
            ))}
          </div>
        ) : null}
        {route.page === "list" ? <List view={route.view} id={route.id} /> : route.page === "promises" ? <Promises /> : <SettingsPage tab={route.tab} />}
      </main>
    </div>
  );
}
