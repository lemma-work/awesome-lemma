// The person's own answers, changeable: just you or your team, promises,
// which agents take tasks; and the sample list.

import { useState } from "react";
import { Bot, Database, Handshake, Settings as Cog, Sparkles, Trash2, Users } from "lucide-react";
import { Button, Card, Face, Switch, runFunction, update, useToast } from "@lemma-plugins/kit";
import { browserZone, findCapabilities, letAgentTakeTasks, useTasks, useWorld } from "./data";
import { agentName } from "./marks";
import { ASSISTANT } from "./types";

export function SettingsPage() {
  const { settings, sample, reload } = useTasks();
  const { lemmaName, agents, canAdmin } = useWorld();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  if (!settings) return null;
  const allowed = settings.agents?.length ? settings.agents : [];
  const save = (patch: Record<string, unknown>, said: string) =>
    void update("tasks_settings", settings.id, patch).then(() => toast(said)).catch((e) => toast(`Couldn't save: ${e.message}`));
  const hasPromises = !!settings.capabilities?.has_promises;

  return (
    <>
      <header className="tk-head">
        <span className="c-header__icon" aria-hidden="true"><Cog size={15} /></span>
        <h1>Settings</h1>
      </header>
      <div className="c-body tk-settings">
        <Card title="Your list" icon={Users}>
          <div className="tk-setrow">
            <div className="c-grow"><b>Team projects</b><p className="c-muted">Show the team's projects beside your own list.</p></div>
            <Switch checked={settings.scope === "team"} onChange={(v) => save({ scope: v ? "team" : "me" }, v ? "Team projects on." : "Just your own list.")} label="Team projects" />
          </div>
          <p className="c-faint tk-setnote">Your own tasks are private: only you see them, and the agent working one for you. Sharing one, or putting it in a team project, shows it to everyone in this Lemma.</p>
        </Card>

        <Card title="Promises you made" icon={Handshake}>
          {hasPromises ? (
            <div className="c-seg tk-setseg" role="radiogroup" aria-label="Promises you made">
              {(["auto", "ask", "never"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={settings.promises === v} aria-selected={settings.promises === v}
                  onClick={() => save({ promises: v }, "Saved.")}>
                  {{ auto: "Make tasks automatically", ask: "Ask me each time", never: "Never" }[v]}
                </button>
              ))}
            </div>
          ) : (
            <p className="c-muted">Mail or Meetings finds promises you make. Neither is in this Lemma.</p>
          )}
        </Card>

        <Card title="Who can take tasks" icon={Bot}>
          <div className="tk-setrow">
            <Face size={22} />
            <div className="c-grow"><b>{lemmaName}</b><p className="c-muted">This Lemma's own assistant.</p></div>
            <Switch checked={allowed.includes(ASSISTANT)} label={`${lemmaName} can take tasks`}
              onChange={(v) => save({ agents: v ? [...new Set([...allowed, ASSISTANT])] : allowed.filter((a) => a !== ASSISTANT) }, "Saved.")} />
          </div>
          {agents.map((a) => (
            <div key={a} className="tk-setrow">
              <Bot size={16} aria-hidden="true" />
              <div className="c-grow"><b>{agentName(a, lemmaName)}</b><p className="c-muted">{canAdmin ? "A named agent in this Lemma." : "An admin has to let it take tasks."}</p></div>
              <Switch checked={allowed.includes(a)} disabled={!canAdmin} label={`${agentName(a, lemmaName)} can take tasks`}
                onChange={(v) => {
                  if (!v) return save({ agents: allowed.filter((x) => x !== a) }, "Saved.");
                  void letAgentTakeTasks(a).then((ok) => ok ? save({ agents: [...new Set([...allowed, a])] }, `${a} can take tasks.`) : toast(`Couldn't let ${a} take tasks: it needs an admin.`));
                }} />
            </div>
          ))}
          <div className="tk-setrow">
            <Sparkles size={16} aria-hidden="true" />
            <div className="c-grow"><b>What this Lemma has</b><p className="c-muted">{[...(settings.capabilities?.plugins || []).map((p) => p.split(" (")[0]), ...(settings.capabilities?.accounts || [])].join(", ") || "Its assistant, web search, documents and files"}. Tasks uses this to suggest what an agent could do.</p></div>
            <Button size="sm" busy={busy === "caps"} onClick={() => { setBusy("caps"); void findCapabilities().then((c) => save({ capabilities: c }, "Looked again.")).finally(() => setBusy("")); }}>Look again</Button>
          </div>
        </Card>

        <Card title="Sample list" icon={Database}>
          <div className="tk-setrow">
            <div className="c-grow">
              <b>{sample ? "The sample is loaded" : "Look around with a sample"}</b>
              <p className="c-muted">Made-up tasks of your own, a made-up team project, and a task an agent could do on its own. Clearing removes only what the sample made.</p>
            </div>
            {sample ? (
              <Button size="sm" icon={Trash2} busy={busy === "clear"} onClick={() => {
                setBusy("clear");
                void runFunction<{ message: string }>("tasks_sample_data", { mode: "clear" }).then((r) => { toast(r.message); void reload(); }).catch((e) => toast(`Couldn't clear it: ${e.message}`)).finally(() => setBusy(""));
              }}>Clear the sample</Button>
            ) : (
              <Button size="sm" busy={busy === "load"} onClick={() => {
                setBusy("load");
                void runFunction<{ message: string }>("tasks_sample_data", { mode: "load", timezone: browserZone() }).then((r) => { toast(r.message); void reload(); }).catch((e) => toast(`Couldn't load it: ${e.message}`)).finally(() => setBusy(""));
              }}>Load the sample</Button>
            )}
          </div>
        </Card>

        <Card title="Ask the Lemma" icon={Sparkles}>
          <p className="c-muted">In this Lemma's chat, say “add a task: …” with a date, a priority or a team project if you like. It adds it here (to your own list unless you name a project), and it can hand it to itself.</p>
        </Card>
      </div>
    </>
  );
}
