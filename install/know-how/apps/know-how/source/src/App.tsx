// Know-how: your procedures, written once, answering questions and walking
// people through each step.
//
// Until the team has a set-up, the set-up (/setup). Then each person's own
// first open (/me), and the app: Answers (/ and /q/<id>), Library (/library),
// a page or a procedure's Playbook (/p/<id>), a walk (/p/<id>/walk). One bar
// on top: the two tabs with their badges, search on `/`, Ask, New page.

import { useEffect, useRef, useState } from "react";
import { BookOpen, FlaskConical, MessagesSquare, Plus, Settings2 } from "lucide-react";
import { AskButton, Banner, Button, DEMO, DataProvider, Kbd, Notice, SearchField, Skeleton, errorText, runFunction, useToast } from "@lemma-plugins/kit";
import { Answers } from "./Answers";
import { LOADERS, WhoProvider, isLate, nowMs, refreshMine, useKnowhow, useWho } from "./data";
import { Library } from "./Library";
import { Me } from "./Me";
import { NewPage } from "./NewPage";
import { PageView } from "./PageView";
import { to, typing, useRoute } from "./route";
import { Setup } from "./Setup";
import { Walk } from "./Walk";
import { ensureMine } from "./wire";

export default function App() {
  return (
    <DataProvider loaders={LOADERS}>
      <WhoProvider>
        <Gate />
      </WhoProvider>
    </DataProvider>
  );
}

function Gate() {
  const d = useKnowhow();
  const route = useRoute();
  if (!d.loaded) {
    return (
      <div className="c-app">
        <div className="kh-top"><span className="kh-top__name"><BookOpen aria-hidden="true" />Know-how</span></div>
        <main className="c-body c-body--wide"><Skeleton kind="table" rows={8} /></main>
      </div>
    );
  }
  if (d.errors.settings || d.errors.articles) return <Notice>Couldn't read Know-how: {errorText(d.errors.settings || d.errors.articles)}</Notice>;
  const s = d.settings;
  if (!s?.setup_done_at || route.page === "setup" || (!s.sample && !s.made.finished && !DEMO)) return <Setup />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const d = useKnowhow();
  const { me } = useWho();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [writing, setWriting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const once = useRef(false);
  const mine = me ? d.people.find((p) => p.member_id === me.id) : undefined;

  useEffect(() => {
    if (once.current || !d.settings || !me) return;
    once.current = true;
    refreshMine();
    if (!DEMO && !d.settings.sample && !mine?.schedule_name) void ensureMine(me.id);
  }, [d.settings, me, mine]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".c-sheet")) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setWriting(true);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  if (me && !DEMO && !d.settings?.sample && !mine?.me_done_at && route.page !== "me" && route.page !== "page") {
    return <Me first />;
  }

  const now = nowMs(d.questions);
  const waiting = d.questions.filter((q) => !q.same_as && !q.walk_step && ["missed", "partly", "wrong", "passed_on"].includes(q.outcome) && ["new", "asked", "drafted"].includes(q.state)).length;
  const late = d.articles.filter((a) => (a.state === "live" || a.state === "due") && isLate(a, now)).length;
  const tab = route.page === "answers" ? "answers" : route.page === "library" ? "library" : route.page === "page" ? "library" : "none";
  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("knowhow_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await d.reload();
      to.answers();
    } catch (e) {
      toast(`Couldn't clear the sample: ${errorText(e)}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="c-app kh-app">
      <header className="kh-top">
        <button type="button" className="kh-top__name" onClick={() => to.answers()}><BookOpen aria-hidden="true" />Know-how</button>
        <nav className="kh-tabs" aria-label="Know-how">
          <button type="button" className="kh-tab" aria-current={tab === "answers" ? "page" : undefined} onClick={() => to.answers()}>
            <MessagesSquare aria-hidden="true" />Answers{waiting ? <span className="kh-tab__n" title={`${waiting} waiting for an answer`}>{waiting}</span> : null}
          </button>
          <button type="button" className="kh-tab" aria-current={tab === "library" ? "page" : undefined} onClick={() => to.library()}>
            <BookOpen aria-hidden="true" />Library{late ? <span className="kh-tab__n" title={`${late} past their check date`}>{late}</span> : null}
          </button>
        </nav>
        <span className="kh-top__fill" />
        <div className="kh-top__search">
          <SearchField value={query} onChange={(v) => { setQuery(v); if (route.page === "page") to.answers(); }} placeholder="Search questions and pages" />
        </div>
        <span className="c-hide-sm"><AskButton text="" label="Ask" /></span>
        <Button icon={Plus} onClick={() => setWriting(true)}>New page <Kbd>N</Kbd></Button>
        <Button variant="ghost" icon={Settings2} label="Set-up" onClick={() => to.setup()} />
      </header>
      {d.sample && !DEMO ? (
        <div className="kh-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at a <b>sample Wednesday</b> at a made-up lighting company. Nothing is posted outside the Lemma. Clear it when you're done.
          </Banner>
        </div>
      ) : null}
      {route.page === "page" ? (route.walk ? <Walk id={route.id} /> : <PageView id={route.id} />)
        : route.page === "library" ? <Library topic={route.topic} mine={route.mine} query={query} />
          : route.page === "me" ? <Me />
            : <Answers openId={route.page === "answers" ? route.id : null} query={query} />}
      <NewPage open={writing} onClose={() => setWriting(false)} />
    </div>
  );
}
