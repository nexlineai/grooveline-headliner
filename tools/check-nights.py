#!/usr/bin/env python3
"""Checks every night's records against its rules, from App/Night.swift and App/Tracks/tracks.json.

Run before and after changing which records a night starts with or carries:
  python3 tools/check-nights.py
It fails (exit 1) on:
  - a record from a later chapter than the night (no spoilers, the career moves forward);
  - a rule record missing from the crate (requests, hot, encore records);
  - a tempo rule with no record to reach it (climbTo, endBPM);
It warns (some are on purpose, e.g. a record that fights every key; a change must not add any):
  - on judgeKeys nights, a record with no key neighbour in its own crate;
  - on Helena's back-to-back nights, a record of yours she has no answer for (key neighbour
    within 2.1 BPM, as `partnerPick` does).
It also prints, per night, how many of its records are from its own and the previous chapter.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
tracks = {t["id"]: t for t in json.loads((ROOT / "App/Tracks/tracks.json").read_text())}
src = (ROOT / "App/Night.swift").read_text()
SPECIAL = {"your-dubplate": {"chapter": 8, "bpm": 124, "camelot": "8A"}, "white-label": tracks.get("white-label", {})}


def info(rid):
    return tracks.get(rid) or SPECIAL.get(rid)


def camelot(c):
    return int(c[:-1]), c[-1]


def compatible(a, b):
    (na, la), (nb, lb) = camelot(a), camelot(b)
    if la == lb:
        d = abs(na - nb) % 12
        return d in (0, 1, 11)
    return na == nb


def ids(body, key):
    m = re.search(key + r": \[([^\]]*)\]", body)
    if not m or not m.group(1).strip():
        return []
    return [s.strip().strip('"') for s in m.group(1).split(",") if s.strip()]


problems = []
warnings = []
for m in re.finditer(r'static let (\w+) = NightInfo\(id: "([^"]+)"(.*?)(?=\n    static let |\n    /// |\n\}\n)', src, re.S):
    nid, body = m.group(2), m.group(3)
    ch = int((re.search(r"chapter: (\d+)", body) or re.search(r"()", "")).group(1) or 1)
    records, bag, hot = ids(body, "records"), ids(body, "bag"), ids(body, "hot")
    encore = [e.replace("WhiteLabel.id", "white-label") for e in ids(body, "encoreWith")]
    partner_bag = ids(body, "partnerBag")
    requests = re.findall(r'record: "([^"]+)"', body)
    helena = "partner:" in body and ".vex" not in body
    crate = bag or [t for t, v in tracks.items() if (v.get("chapter") or 1) <= ch and t != "white-label"]
    if "lastRecord: WhiteLabel.id" in body:
        crate = crate + ["white-label"]
    mine = records + bag
    for rid in set(mine + partner_bag + requests + hot):
        r = info(rid)
        if r is None:
            problems.append(f"{nid}: unknown record {rid}")
        elif (r.get("chapter") or 1) > ch:
            problems.append(f"{nid}: {rid} is from chapter {r.get('chapter')} (night is chapter {ch})")
    for rid in requests + hot + encore:
        if rid not in crate and rid not in records:
            problems.append(f"{nid}: rule record {rid} is not in the crate")
    climb = re.search(r"climbTo: ([\d.]+)", body)
    if climb and not any(info(r)["bpm"] >= float(climb.group(1)) - 2 for r in crate if info(r)):
        problems.append(f"{nid}: nothing in the crate reaches {climb.group(1)} BPM")
    end = re.search(r"endBPM: ([\d.]+)", body)
    if end and not any(info(r)["bpm"] <= float(end.group(1)) + 2 for r in crate if info(r)):
        problems.append(f"{nid}: nothing in the crate is slow enough for {end.group(1)} BPM")
    if "judgeKeys: true" in body and bag:
        for rid in set(bag + records):
            if rid == "white-label" or not info(rid):
                continue
            if not any(o != rid and info(o) and compatible(info(rid)["camelot"], info(o)["camelot"]) for o in set(bag + records)):
                warnings.append(f"{nid}: {rid} ({info(rid)['camelot']}) has no key neighbour in its crate")
    if helena and partner_bag:
        p = int(re.search(r"partner: (\d)", body).group(1))
        yours = set(bag + [records[1 - p]] if len(records) == 2 else bag)
        for rid in yours:
            r = info(rid)
            if not any(compatible(r["camelot"], info(a)["camelot"]) and abs(r["bpm"] - info(a)["bpm"]) <= 2.1
                       for a in partner_bag if a != rid and info(a)):
                warnings.append(f"{nid}: Helena has no answer for {rid} ({r['bpm']} {r['camelot']})")
    pool = set(records + bag)
    recent = sum(1 for r in pool if info(r) and (info(r).get("chapter") or 1) >= ch - 1)
    print(f"{nid:16s} ch{ch:<2d} start {'/'.join(records) or '(first two)':28s} crate {len(crate):2d}  "
          f"recent {recent}/{len(pool) or '-'}")

if warnings:
    print("\nwarnings:")
    for w in warnings:
        print("  " + w)
if problems:
    print("\nPROBLEMS:")
    for p in problems:
        print("  " + p)
    sys.exit(1)
print("\nall nights pass")
