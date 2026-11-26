// The members' side: signed in through the kit's boot().
import { boot } from "@lemma-plugins/kit";
import "../ea.css";
import App from "./App";

export function start(): void {
  boot(<App />);
}
