MAX_SENTENCES = 63
MAX_PICKED = 14
_SPLIT = _re.compile(r"(?<=[.!?])[\"'”’)]*\s+(?=[\"'“‘(]?[A-Z0-9])")


def sentences_of(text: str) -> list:
    """A turn's text as sentences, quoted lines and signatures left out."""
    out = []
    for para in _re.split(r"\n\s*\n|\n(?=[-*•] )", str(text or "")):
        para = " ".join(line.strip() for line in para.splitlines() if line.strip() and not line.strip().startswith(">"))
        if not para or para.lower().startswith(("on ", "sent from", "--")) and len(para) < 200 and "wrote" in para.lower():
            continue
        for s in _SPLIT.split(para):
            s = s.strip().strip("*_").strip()
            if 12 <= len(s) <= 600 and _re.search(r"[A-Za-z]{3}", s):
                out.append(s)
    return out


def _product_line(p: dict) -> str:
    also = [*(p.get("aliases") or [])][:4]
    return f"{p['name']} ({'ours' if p.get('role') != 'rival' else 'a rival'})" + (f": also {', '.join(also)}" if also else "")


def _feature_option(f: dict, by_id: dict) -> dict:
    parent = by_id.get(f.get("parent_id"))
    head = (f"{parent['name']} > " if parent else "") + f["name"]
    text = head + (f": {f['description']}" if f.get("description") else "")
    if f.get("aliases"):
        text += f". Also called: {', '.join(f['aliases'][:6])}"
    return {"const": f["id"], "description": clip(text, 300)}



def instruction_for(products: list, team: str, source: str) -> str:
    ours = [p for p in products if p.get("role") != "rival"]
    rivals = [p for p in products if p.get("role") == "rival"]
    fill = {"team": team or "the team", "source": source, "ours": "; ".join(_product_line(p) for p in ours),
            "rivals": "; ".join(_product_line(p) for p in rivals) or "none named yet"}
    return "\n".join(line.format(**fill) for line in READ["instruction"])


def classify(pod, quote: str, around: list, who, products: list, features: list, instruction: str, examples=None,
             ask=("product", "feature", "kind", "sentiment", "importance", "rivals"), allow_none: bool = False) -> tuple:
    """One sentence's product, feature, kind, sentiment, importance and rivals
    named: one Decisions call. ({...}, calls). With `allow_none` (reading a
    passage), the product question can answer none, and the result's
    `product_id` is then None: the sentence is about something else."""
    ours = [p for p in products if p.get("role") != "rival"]
    rivals = [p for p in products if p.get("role") == "rival"]
    by_id = {f["id"]: f for f in features}
    short = shortlist(features, quote)
    props = {}
    if "product" in ask and (len(products) > 1 or allow_none):
        props["product"] = dict(READ["questions"]["product"], oneOf=[
            *({"const": p["id"], "description": clip(_product_line(p), 300)} for p in products[:63]),
            *([READ["none_option"]] if allow_none else [])])
    if "feature" in ask and short:
        props["feature"] = dict(READ["questions"]["feature"], oneOf=[
            *(_feature_option(f, by_id) for f in short), READ["none_option"]])
    for key in ("kind", "sentiment", "importance"):
        if key in ask:
            props[key] = READ["questions"][key]
    if "rivals" in ask and rivals:
        props["rivals"] = dict(READ["questions"]["rivals"], items={"type": "string", "oneOf": [
            *({"const": p["id"], "description": clip(_product_line(p), 300)} for p in rivals[:63]), READ["none_option"]]})
    out = {"quote": quote, "product_id": ours[0]["id"] if ours else None, "feature_id": None, "confidence": None,
           "kind": "other", "sentiment": None, "importance": "unknown", "compared_with": None, "options": [], "matched": {}}
    if not props:
        return out, 0
    evidence = "\n".join([f"Sentence: {quote}", f"Said by: {who or 'someone'}", "", "Around it:", *(around or ["(nothing)"])])
    allowed = {f["id"] for f in short} | {"none"}
    usable = [{"evidence": e["evidence"], "answers": {k: v for k, v in e["answers"].items() if k in props}}
              for e in (examples or []) if e["answers"].get("feature") in allowed]
    got, calls = decide(pod, "\n".join([instruction, *READ["sentence_instruction"]]),
                        {"type": "object", "properties": props}, evidence,
                        [u for u in usable if u["answers"]][:20] or None)
    product, _ = answer(got, "product")
    feature, fconf = answer(got, "feature")
    kind, _ = answer(got, "kind")
    sentiment, _ = answer(got, "sentiment")
    importance, _ = answer(got, "importance")
    named, _ = answer(got, "rivals")
    if product in {p["id"] for p in products}:
        out["product_id"] = product
    elif allow_none and product == "none":
        out["product_id"] = None
        return out, calls
    out["feature_id"] = feature if feature in by_id else None
    out["confidence"] = fconf
    compared = [r for r in (named or []) if r in {p["id"] for p in rivals} and r != out["product_id"]]
    out["compared_with"] = compared or None
    out["kind"] = kind if kind in KINDS else ("comparison" if compared else "other")
    out["sentiment"] = sentiment if sentiment in SENTIMENTS else None
    out["importance"] = importance if importance in IMPORTANCE else "unknown"
    if short:
        out["options"], out["matched"] = options_for(out["feature_id"], quote, short)
    return out, calls


def read_passage(pod, turns: list, products: list, features: list, team: str, source: str, examples=None) -> tuple:
    """Find the sentences about a product in `turns` ([{who, outside, text,
    at_seconds, said_at}]), word for word, each with product, feature, kind,
    sentiment, importance and rivals. (found, stats)."""
    stats = {"calls": 0, "gate": None, "gate_confidence": None, "sentences": 0}
    ours = [p for p in products if p.get("role") != "rival"]
    rivals = [p for p in products if p.get("role") == "rival"]
    if not ours:
        return [], stats
    instruction = instruction_for(products, team, source)

    # Number the outside speakers' sentences; the team's words stay as context.
    numbered, lines = [], []
    for t in turns:
        stamp = f" at {t['at_seconds'] // 60}:{t['at_seconds'] % 60:02d}" if t.get("at_seconds") is not None else ""
        lines.append(f"[{t.get('who') or 'Someone'}{' (the team)' if not t.get('outside') else ''}{stamp}]")
        if not t.get("outside"):
            lines.append(clip(t.get("text") or "", 1500) or "")
            continue
        for s in sentences_of(t.get("text") or ""):
            numbered.append({"text": s, "turn": t})
            lines.append(f"[s{len(numbered)}] {s}")
        lines.append("")
    stats["sentences"] = len(numbered)
    if not numbered:
        return [], stats
    passage = "\n".join(lines)

    gate, stats["calls"] = decide(pod, instruction, {"type": "object", "properties": {"gate": READ["gate"]}}, passage)
    value, conf = answer(gate, "gate")
    stats["gate"], stats["gate_confidence"] = value, conf
    if value is False and (conf is None or conf >= READ["unsure_below"]["gate"]):
        return [], stats
    if value is None and not gate:
        return [], stats

    picked = []
    for start in range(0, len(numbered), MAX_SENTENCES):
        chunk = numbered[start : start + MAX_SENTENCES]
        evidence = passage
        if len(numbered) > MAX_SENTENCES:  # renumber this chunk only
            evidence = "\n".join(f"[s{i + 1}] {n['text']}" for i, n in enumerate(chunk))
        question = dict(READ["sentences"], items={"type": "string", "oneOf": [
            *({"const": f"s{i + 1}"} for i in range(len(chunk))), READ["none_option"]]})
        got, calls = decide(pod, instruction, {"type": "object", "properties": {"sentences": question}}, evidence)
        stats["calls"] += calls
        value, conf = answer(got, "sentences")
        for key in value or []:
            if key != "none" and _re.fullmatch(r"s\d+", str(key)) and int(key[1:]) <= len(chunk):
                picked.append(chunk[int(key[1:]) - 1])
    picked = picked[:MAX_PICKED]
    if not picked:
        return [], stats

    def one(n):
        i = next(k for k, x in enumerate(numbered) if x is n)
        around = [x["text"] for x in numbered[max(0, i - 2): i] + numbered[i + 1: i + 3]]
        got, calls = classify(pod, n["text"], around, n["turn"].get("who"), products, features, instruction, examples,
                              allow_none=True)
        got["turn"] = n["turn"]
        return got, calls

    with _Pool(max_workers=3) as pool:
        done = list(pool.map(one, picked))
    found = [d for d, _ in done if d.get("product_id")]  # about none of the products: dropped
    stats["calls"] += sum(c for _, c in done)
    return found, stats


def examples_from(pod, member=None, limit: int = 20) -> list:
    """A person's moves, as worked examples for the next read: the team's last
    corrections, this member's first (a correction is a feedback row a person
    filed, `filed_by` person)."""
    order = f"CASE WHEN heard_by = {lit(member)} THEN 0 ELSE 1 END, " if member else ""
    out = []
    for r in q(pod, "SELECT quote, feature_id, kind, importance FROM feedback WHERE filed_by = 'person' "
                    f"AND feature_id IS NOT NULL ORDER BY {order}updated_at DESC LIMIT {int(limit)}"):
        answers = {"feature": r["feature_id"]}
        if r.get("kind") in KINDS:
            answers["kind"] = r["kind"]
        if r.get("importance") in IMPORTANCE and r["importance"] != "unknown":
            answers["importance"] = r["importance"]
        out.append({"evidence": f"Sentence: {r['quote']}", "answers": answers})
    return out
# end user-feedback:reader
