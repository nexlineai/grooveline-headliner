// The career's content for the web, read from the iPhone app's Swift source (which stays the one
// source until the iPhone release; see the vault note). Lessons, nights, chapters and the night
// lines are plain literals in App/Lesson.swift, Night.swift and Chapter.swift; this reads them with
// a small parser for exactly that subset of Swift and writes web/content/career.json.
//
//   node tools/content.ts           write web/content/career.json (and check it)
//   node tools/content.ts --check   fail when career.json is not what the Swift says (CI)
//
// It fails loudly on anything it does not understand: an unknown field or enum case, a reference
// it cannot resolve, a string with interpolation. Defaults come from the Swift declarations
// themselves (struct `var x = ...`, enum case `tolerance: Double = 0.07`), never from a copy here.
// Then it checks the result against what exists: every voice line is a file in App/Lessons, every
// record is in tracks.json, every scene in scenes.json, every room has its picture.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(WEB, "..");
const APP = path.join(ROOT, "App");
const OUT = path.join(WEB, "content", "career.json");
const SOURCES = ["Lesson.swift", "Night.swift", "Chapter.swift", "Game.swift"];

// MARK: - Tokens

type Tok = { k: "str" | "istr" | "num" | "id" | "p"; v: string; at: string };

function tokenize(src: string, file: string): Tok[] {
  const out: Tok[] = [];
  let i = 0, line = 1;
  const where = () => `${file}:${line}`;
  const puncts = ["...", "..<", "->", "==", "!=", "<=", ">=", "&&", "||", "??"];
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith("//", i)) { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (src.startsWith("/*", i)) {
      let depth = 0;
      do {
        if (src.startsWith("/*", i)) { depth++; i += 2; } else if (src.startsWith("*/", i)) { depth--; i += 2; } else { if (src[i] === "\n") line++; i++; }
      } while (depth > 0 && i < src.length);
      continue;
    }
    if (src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const body = src.slice(i + 3, end);
      line += body.split("\n").length - 1;
      out.push({ k: "istr", v: body, at: where() }); // multi-line strings are not content
      i = end + 3;
      continue;
    }
    if (c === '"') {
      const at = where();
      let v = "", interp = false;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") {
          const e = src[i + 1];
          if (e === "(") {
            // Interpolation: skip the balanced expression (strings inside included).
            interp = true;
            let depth = 1;
            i += 2;
            while (i < src.length && depth > 0) {
              if (src[i] === '"') { i++; while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1; }
              else if (src[i] === "(") depth++;
              else if (src[i] === ")") depth--;
              i++;
            }
            continue;
          }
          if (e === "u" && src[i + 2] === "{") {
            const close = src.indexOf("}", i);
            v += String.fromCodePoint(parseInt(src.slice(i + 3, close), 16));
            i = close + 1;
            continue;
          }
          v += ({ n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "'": "'", "\\": "\\" } as Record<string, string>)[e] ?? e;
          i += 2;
          continue;
        }
        v += src[i++];
      }
      i++;
      out.push({ k: interp ? "istr" : "str", v, at });
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (/[0-9_]/.test(src[j])) j++;
      if (src[j] === "." && /[0-9]/.test(src[j + 1] ?? "")) { j++; while (/[0-9_]/.test(src[j])) j++; }
      if (/[eE]/.test(src[j]) && /[-+0-9]/.test(src[j + 1] ?? "")) { j += 2; while (/[0-9]/.test(src[j])) j++; }
      out.push({ k: "num", v: src.slice(i, j).replace(/_/g, ""), at: where() });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (/[A-Za-z0-9_]/.test(src[j] ?? "")) j++;
      out.push({ k: "id", v: src.slice(i, j), at: where() });
      i = j;
      continue;
    }
    if (c === "`") { // `default` and friends as names
      const j = src.indexOf("`", i + 1);
      out.push({ k: "id", v: src.slice(i + 1, j), at: where() });
      i = j + 1;
      continue;
    }
    const p = puncts.find((x) => src.startsWith(x, i)) ?? c;
    out.push({ k: "p", v: p, at: where() });
    i += p.length;
  }
  return out;
}

// MARK: - Expressions and types

type Arg = { label: string | null; value: Node };
type Node =
  | { k: "num"; v: number } | { k: "str"; v: string } | { k: "bool"; v: boolean } | { k: "nil" }
  | { k: "arr"; items: Node[] } | { k: "dict"; entries: [Node, Node][] } | { k: "tuple"; items: Arg[] }
  | { k: "case"; name: string; args: Arg[] | null } | { k: "call"; callee: string[]; args: Arg[] }
  | { k: "ref"; path: string[] } | { k: "range"; lo: Node; hi: Node }
  | { k: "bin"; op: string; l: Node; r: Node } | { k: "neg"; v: Node };

type Type =
  | { k: "name"; name: string; args: Type[] } | { k: "opt"; t: Type } | { k: "arr"; t: Type }
  | { k: "dict"; key: Type; val: Type } | { k: "tuple"; items: { label: string | null; t: Type }[] };

class Parser {
  i = 0;
  readonly toks: Tok[];
  constructor(toks: Tok[]) { this.toks = toks; }
  get t(): Tok { return this.toks[this.i] ?? { k: "p", v: "<end>", at: "end" }; }
  is(v: string): boolean { return this.t.v === v && (this.t.k === "p" || this.t.k === "id"); }
  eat(v: string): void {
    if (!this.is(v)) throw new Error(`${this.t.at}: expected "${v}", found "${this.t.v}"`);
    this.i++;
  }
  /** A label (`name:`) next, not a dictionary key or a ternary. */
  private labelAhead(): boolean { return this.t.k === "id" && this.toks[this.i + 1]?.v === ":"; }

  expr(): Node {
    const l = this.add();
    if (this.is("...") || this.is("..<")) {
      if (this.is("..<")) throw new Error(`${this.t.at}: half-open ranges are not content`);
      this.i++;
      return { k: "range", lo: l, hi: this.add() };
    }
    return l;
  }
  private add(): Node {
    let l = this.mul();
    while (this.t.k === "p" && (this.t.v === "+" || this.t.v === "-")) { const op = this.t.v; this.i++; l = { k: "bin", op, l, r: this.mul() }; }
    return l;
  }
  private mul(): Node {
    let l = this.unary();
    while (this.t.k === "p" && (this.t.v === "*" || this.t.v === "/")) { const op = this.t.v; this.i++; l = { k: "bin", op, l, r: this.unary() }; }
    return l;
  }
  private unary(): Node {
    if (this.t.k === "p" && this.t.v === "-") { this.i++; return { k: "neg", v: this.unary() }; }
    return this.postfix();
  }
  private postfix(): Node {
    const t = this.t;
    if (t.k === "num") { this.i++; return { k: "num", v: Number(t.v) }; }
    if (t.k === "str") { this.i++; return { k: "str", v: t.v }; }
    if (t.k === "istr") throw new Error(`${t.at}: a string with interpolation in the content`);
    if (t.k === "p" && t.v === ".") {
      this.i++;
      const name = this.t.v;
      this.i++;
      return { k: "case", name, args: this.is("(") ? this.args() : null };
    }
    if (t.k === "p" && t.v === "[") return this.collection();
    if (t.k === "p" && t.v === "(") return { k: "tuple", items: this.args() };
    if (t.k === "id") {
      if (t.v === "true" || t.v === "false") { this.i++; return { k: "bool", v: t.v === "true" }; }
      if (t.v === "nil") { this.i++; return { k: "nil" }; }
      const pathParts = [t.v];
      this.i++;
      while (this.is(".") && this.toks[this.i + 1]?.k === "id") { this.i++; pathParts.push(this.t.v); this.i++; }
      if (this.is("(")) return { k: "call", callee: pathParts, args: this.args() };
      if (this.is("{")) throw new Error(`${this.t.at}: a closure in the content`);
      return { k: "ref", path: pathParts };
    }
    throw new Error(`${t.at}: unexpected "${t.v}"`);
  }
  private args(): Arg[] {
    this.eat("(");
    const out: Arg[] = [];
    while (!this.is(")")) {
      let label: string | null = null;
      if (this.labelAhead()) { label = this.t.v; this.i += 2; }
      out.push({ label, value: this.expr() });
      if (!this.is(")")) this.eat(",");
    }
    this.eat(")");
    return out;
  }
  private collection(): Node {
    this.eat("[");
    if (this.is(":")) { this.i++; this.eat("]"); return { k: "dict", entries: [] }; }
    if (this.is("]")) { this.i++; return { k: "arr", items: [] }; }
    const first = this.expr();
    if (this.is(":")) {
      const entries: [Node, Node][] = [];
      this.i++;
      entries.push([first, this.expr()]);
      while (this.is(",")) {
        this.i++;
        if (this.is("]")) break;
        const key = this.expr();
        this.eat(":");
        entries.push([key, this.expr()]);
      }
      this.eat("]");
      return { k: "dict", entries };
    }
    const items = [first];
    while (this.is(",")) {
      this.i++;
      if (this.is("]")) break;
      items.push(this.expr());
    }
    this.eat("]");
    return { k: "arr", items };
  }

  type(): Type {
    let t: Type;
    if (this.is("[")) {
      this.i++;
      const a = this.type();
      if (this.is(":")) { this.i++; const v = this.type(); this.eat("]"); t = { k: "dict", key: a, val: v }; }
      else { this.eat("]"); t = { k: "arr", t: a }; }
    } else if (this.is("(")) {
      this.i++;
      const items: { label: string | null; t: Type }[] = [];
      while (!this.is(")")) {
        let label: string | null = null;
        if (this.labelAhead()) { label = this.t.v; this.i += 2; }
        items.push({ label, t: this.type() });
        if (!this.is(")")) this.eat(",");
      }
      this.eat(")");
      t = { k: "tuple", items };
    } else {
      let name = this.t.v;
      this.i++;
      while (this.is(".") && this.toks[this.i + 1]?.k === "id") { this.i++; name = this.t.v; this.i++; } // Game.Screen -> Screen
      const args: Type[] = [];
      if (this.is("<")) {
        this.i++;
        args.push(this.type());
        while (this.is(",")) { this.i++; args.push(this.type()); }
        this.eat(">");
      }
      t = { k: "name", name, args };
    }
    while (this.is("?") || this.is("!")) { this.i++; t = { k: "opt", t }; }
    return t;
  }

  /** Skips a balanced { ... } (or ( ... ), [ ... ]) starting at the current token. */
  skipBalanced(): void {
    const open = this.t.v, close = ({ "{": "}", "(": ")", "[": "]" } as Record<string, string>)[open];
    let depth = 0;
    do {
      if (this.t.k === "p" && this.t.v === open) depth++;
      else if (this.t.k === "p" && this.t.v === close) depth--;
      this.i++;
    } while (depth > 0 && this.i < this.toks.length);
  }
}

// MARK: - Declarations

interface Field { name: string; type: Type | null; def: Node | null; }
interface CaseParam { label: string | null; type: Type; def: Node | null; }
interface EnumCase { name: string; params: CaseParam[] | null; }

const structs = new Map<string, Field[]>();
const enums = new Map<string, EnumCase[]>();
/** Statics by namespace (enum, struct or class name) and name. */
const statics = new Map<string, Map<string, { type: Type | null; node: Node; ns: string }>>();

const MODIFIERS = new Set(["private", "fileprivate", "public", "internal", "final", "static", "mutating", "lazy", "weak", "override", "nonisolated", "indirect"]);

function readDeclarations(file: string): void {
  const toks = tokenize(readFileSync(path.join(APP, file), "utf8"), file);
  const p = new Parser(toks);
  const scan = (ns: string | null, kind: string | null) => {
    while (p.i < toks.length && !p.is("}")) {
      const t = p.t;
      if (t.k === "p" && t.v === "@") { p.i += 2; if (p.is("(")) p.skipBalanced(); continue; }
      if (t.k === "id" && (t.v === "struct" || t.v === "enum" || t.v === "class" || t.v === "extension" || t.v === "protocol")) {
        const what = t.v;
        p.i++;
        const name = p.t.v;
        while (!p.is("{")) p.i++;
        p.i++;
        if (what === "struct") structs.set(name, []);
        if (what === "enum" && !enums.has(name)) enums.set(name, []);
        scan(name, what);
        p.eat("}");
        continue;
      }
      if (t.k === "id" && t.v === "case" && kind === "enum" && ns) {
        p.i++;
        for (;;) {
          const name = p.t.v;
          p.i++;
          let params: CaseParam[] | null = null;
          if (p.is("(")) {
            params = [];
            p.i++;
            while (!p.is(")")) {
              let label: string | null = null;
              if (p.t.k === "id" && toks[p.i + 1]?.v === ":") { label = p.t.v; p.i += 2; }
              const type = p.type();
              let def: Node | null = null;
              if (p.is("=")) { p.i++; def = p.expr(); }
              params.push({ label, type, def });
              if (!p.is(")")) p.eat(",");
            }
            p.eat(")");
          }
          if (p.is("=")) { p.i++; p.expr(); } // raw values
          enums.get(ns)!.push({ name, params });
          if (!p.is(",")) break;
          p.i++;
        }
        continue;
      }
      if (t.k === "id" && (t.v === "var" || t.v === "let")) {
        // Was it static? Look back over the modifiers.
        let j = p.i - 1, isStatic = false;
        while (j >= 0 && toks[j].k === "id" && MODIFIERS.has(toks[j].v)) { if (toks[j].v === "static") isStatic = true; j--; }
        p.i++;
        if (p.is("(")) { p.skipBalanced(); continue; } // tuple destructuring: not content
        const name = p.t.v;
        p.i++;
        let type: Type | null = null, def: Node | null = null;
        if (p.is(":")) { p.i++; type = p.type(); }
        if (p.is("=")) {
          p.i++;
          const start = p.i;
          try {
            def = p.expr();
          } catch {
            def = null; // code, not content: skip to the end of the line's statement
            p.i = start;
            while (p.i < toks.length && !(p.t.at !== toks[start].at && toks[p.i - 1]?.at !== p.t.at) && !p.is("}")) {
              if (p.is("{") || p.is("(") || p.is("[")) p.skipBalanced(); else p.i++;
            }
          }
        }
        if (p.is("{")) { p.skipBalanced(); continue; } // computed property or observers
        if (ns && isStatic && def) {
          if (!statics.has(ns)) statics.set(ns, new Map());
          statics.get(ns)!.set(name, { type, node: def, ns });
        } else if (ns && !isStatic && kind === "struct" && toks[j]?.v !== "private") {
          structs.get(ns)!.push({ name, type, def });
        }
        continue;
      }
      if (t.k === "id" && (t.v === "func" || t.v === "init" || t.v === "subscript" || t.v === "deinit")) {
        while (!p.is("{")) p.i++;
        p.skipBalanced();
        continue;
      }
      if (p.is("{") || p.is("(") || p.is("[")) { p.skipBalanced(); continue; }
      p.i++;
    }
  };
  scan(null, null);
}

// MARK: - Values

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Names for enum values the Swift declares without a label (by position). */
const POSITIONAL: Record<string, Record<string, string[]>> = {
  LessonTarget: { play: ["deck"], cue: ["deck"], channel: ["deck"], eq: ["deck", "band"], phones: ["deck"], pitch: ["deck"], record: ["deck"], sync: ["deck"], filter: ["deck"] },
  LessonGoal: {
    startDeck: ["deck"], bars: ["bars"], channelFader: ["deck", "range"], crossfader: ["range"], eq: ["deck", "band", "range"],
    phonesCue: ["deck"], cueMix: ["range"], syncOn: ["deck"], filter: ["deck", "range"], studioPage: ["page"], stopDeck: ["deck"],
  },
  Screen: { chapter: ["number"], story: ["id"], lesson: ["id"], night: ["id"] },
};

const NAMED_PATTERNS = new Set(["house", "track"]); // DrumPattern's statics (HeadlinerCore)

/** `Mishap.cable`: a case of an enum (not a static of a namespace enum such as `WhiteLabel.id`). */
function isCaseRef(n: Node): boolean {
  return n.k === "ref" && n.path.length === 2 && !!enums.get(n.path[0])?.some((c) => c.name === n.path[1]);
}

function inferType(n: Node): Type | null {
  switch (n.k) {
    case "str": return { k: "name", name: "String", args: [] };
    case "num": case "bin": case "neg": return { k: "name", name: "Double", args: [] };
    case "bool": return { k: "name", name: "Bool", args: [] };
    case "call": return { k: "name", name: n.callee[n.callee.length - 1], args: [] };
    case "ref": return isCaseRef(n) ? { k: "name", name: n.path[0], args: [] } : null;
    case "arr": { const e = n.items[0] ? inferType(n.items[0]) : null; return e ? { k: "arr", t: e } : null; }
    case "tuple": return n.items.every((a) => a.label) ? { k: "tuple", items: n.items.map((a) => ({ label: a.label, t: inferType(a.value) ?? { k: "name", name: "Any", args: [] } })) } : null;
    default: return null;
  }
}

function num(n: Node, at: string): number {
  switch (n.k) {
    case "num": return n.v;
    case "neg": return -num(n.v, at);
    case "bin": {
      const l = num(n.l, at), r = num(n.r, at);
      return n.op === "+" ? l + r : n.op === "-" ? l - r : n.op === "*" ? l * r : l / r;
    }
    case "ref": { const v = resolve(n.path, at); if (typeof v === "number") return v; break; }
    default: break;
  }
  throw new Error(`${at}: expected a number, found ${JSON.stringify(n)}`);
}

const resolving = new Set<string>();
const resolved = new Map<string, Json>();

/** The value a reference names: `Nights.nightBefore.id`, `WhiteLabel.id`, `caveBag` (same namespace). */
function resolve(pathParts: string[], at: string, ns: string | null = null): Json {
  let owner: string | null = null, rest: string[] = [];
  if (statics.get(pathParts[0])?.has(pathParts[1] ?? "")) { owner = pathParts[0]; rest = pathParts.slice(1); }
  else if (ns && statics.get(ns)?.has(pathParts[0])) { owner = ns; rest = pathParts; }
  if (!owner) throw new Error(`${at}: cannot resolve ${pathParts.join(".")}`);
  const key = `${owner}.${rest[0]}`;
  if (!resolved.has(key)) {
    if (resolving.has(key)) throw new Error(`${at}: ${key} refers to itself`);
    resolving.add(key);
    const s = statics.get(owner)!.get(rest[0])!;
    resolved.set(key, convert(s.node, s.type ?? inferType(s.node), owner, key));
    resolving.delete(key);
  }
  let v: Json = resolved.get(key) ?? null;
  for (const f of rest.slice(1)) {
    if (v === null || typeof v !== "object" || Array.isArray(v) || !(f in v)) throw new Error(`${at}: ${pathParts.join(".")}: no "${f}"`);
    v = (v as Record<string, Json>)[f];
  }
  return v;
}

/** One Swift value as JSON, shaped by the type it is declared with. */
function convert(n: Node, type: Type | null, ns: string, at: string): Json {
  if (n.k === "ref" && !isCaseRef(n)) return resolve(n.path, at, ns);
  // An untyped list of references (`static let all = [firstParty, ...]`): each one has its own type.
  if (!type && n.k === "arr" && n.items.every((x) => x.k === "ref" && !isCaseRef(x))) {
    return n.items.map((x, i) => convert(x, null, ns, `${at}[${i}]`));
  }
  if (!type) type = inferType(n);
  if (!type) throw new Error(`${at}: no type for ${JSON.stringify(n).slice(0, 120)}`);
  switch (type.k) {
    case "opt":
      return n.k === "nil" ? null : convert(n, type.t, ns, at);
    case "arr":
      if (n.k !== "arr") throw new Error(`${at}: expected an array`);
      return n.items.map((x, i) => convert(x, type.t, ns, `${at}[${i}]`));
    case "dict": {
      if (n.k !== "dict") throw new Error(`${at}: expected a dictionary`);
      const o: Record<string, Json> = {};
      for (const [k, v] of n.entries) {
        const key = convert(k, type.key, ns, at);
        o[String(key)] = convert(v, type.val, ns, `${at}.${key}`);
      }
      return o;
    }
    case "tuple": {
      if (n.k !== "tuple" || n.items.length !== type.items.length) throw new Error(`${at}: expected a tuple of ${type.items.length}`);
      const o: Record<string, Json> = {};
      type.items.forEach((ti, i) => {
        const a = n.items[i];
        const label = ti.label ?? a.label;
        if (!label) throw new Error(`${at}: a tuple value without a name`);
        if (a.label && ti.label && a.label !== ti.label) throw new Error(`${at}: tuple label ${a.label} is not ${ti.label}`);
        o[label] = convert(a.value, ti.t, ns, `${at}.${label}`);
      });
      return o;
    }
    case "name":
      break;
  }
  const name = type.name;
  switch (name) {
    case "String":
      if (n.k !== "str") throw new Error(`${at}: expected a string`);
      return n.v;
    case "Int": case "Double": case "CGFloat": case "Float":
      return num(n, at);
    case "Bool":
      if (n.k !== "bool") throw new Error(`${at}: expected true or false`);
      return n.v;
    case "ClosedRange":
      if (n.k !== "range") throw new Error(`${at}: expected a range`);
      return [num(n.lo, at), num(n.hi, at)];
    case "DrumPattern":
      if (n.k === "case" && !n.args && NAMED_PATTERNS.has(n.name)) return n.name;
      throw new Error(`${at}: only the named drum patterns (${[...NAMED_PATTERNS]}) can be content`);
  }
  if (structs.has(name)) return convertStruct(n, name, ns, at);
  if (enums.has(name)) return convertCase(n, name, ns, at);
  throw new Error(`${at}: unknown type ${name}`);
}

function convertStruct(n: Node, name: string, ns: string, at: string): Json {
  if (n.k !== "call" || n.callee[n.callee.length - 1] !== name) throw new Error(`${at}: expected ${name}(...)`);
  const fields = structs.get(name)!;
  const given = new Map<string, Node>();
  for (const a of n.args) {
    if (!a.label) throw new Error(`${at}: ${name}(...) with an unlabelled value`);
    if (!fields.some((f) => f.name === a.label)) throw new Error(`${at}: ${name} has no field "${a.label}"`);
    given.set(a.label, a.value);
  }
  const o: Record<string, Json> = {};
  for (const f of fields) {
    const v = given.get(f.name) ?? f.def ?? (f.type?.k === "opt" ? { k: "nil" } as Node : null);
    if (!v) throw new Error(`${at}: ${name} needs "${f.name}"`);
    const type = f.type ?? (f.def ? inferType(f.def) : null);
    o[f.name] = convert(v, type, ns, `${at}.${f.name}`);
  }
  return o;
}

function convertCase(n: Node, name: string, ns: string, at: string): Json {
  let caseName: string, args: Arg[] | null;
  if (n.k === "case") { caseName = n.name; args = n.args; }
  else if (n.k === "ref" && n.path[0] === name) { caseName = n.path[1]; args = null; }
  else throw new Error(`${at}: expected a ${name} case`);
  const decl = enums.get(name)!.find((c) => c.name === caseName);
  if (!decl) throw new Error(`${at}: ${name} has no case "${caseName}"`);
  const simple = enums.get(name)!.every((c) => !c.params);
  if (simple) {
    if (args) throw new Error(`${at}: ${name}.${caseName} takes no values`);
    return caseName;
  }
  const o: Record<string, Json> = { type: caseName };
  const params = decl.params ?? [];
  if (!args && params.some((p) => !p.def)) throw new Error(`${at}: ${name}.${caseName} needs values`);
  const given = args ?? [];
  if (given.length > params.length) throw new Error(`${at}: too many values for ${name}.${caseName}`);
  // Swift matches values to parameters in order; a defaulted labelled parameter may be left out.
  let gi = 0;
  params.forEach((p, pi) => {
    const key = p.label ?? POSITIONAL[name]?.[caseName]?.[pi];
    if (!key) throw new Error(`${at}: no name for value ${pi} of ${name}.${caseName}; add it to POSITIONAL`);
    const a = given[gi];
    if (a && (a.label ?? null) === (p.label ?? null)) {
      o[key] = convert(a.value, p.type, ns, `${at}.${key}`);
      gi++;
    } else if (p.def) {
      o[key] = convert(p.def, p.type, ns, `${at}.${key}`);
    } else {
      throw new Error(`${at}: ${name}.${caseName} needs "${key}"`);
    }
  });
  if (gi !== given.length) throw new Error(`${at}: ${name}.${caseName}: values do not match the declaration`);
  return o;
}

// MARK: - The career

function build(): Record<string, Json> {
  for (const f of SOURCES) readDeclarations(f);
  const take = (ns: string, name: string) => resolve([ns, name], `${ns}.${name}`);
  return {
    source: "Generated by web/tools/content.ts from App/Lesson.swift, Night.swift and Chapter.swift. Do not edit: change the Swift, then run the tool.",
    chapters: take("Chapters", "all"),
    lessons: take("Lessons", "all"),
    nights: take("Nights", "all"),
    nightLines: take("NightRunner", "lines"),
    moods: take("NightRunner", "moods"),
    handsOff: take("Lessons", "handsOff"),
    whiteLabel: take("WhiteLabel", "id"),
  };
}

// MARK: - Checks against what exists

/** Files the repo holds (from git, so it also works in a sparse CI checkout without the media). */
function tracked(): Set<string> {
  const out = execFileSync("git", ["ls-files", "App"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
  return new Set(out.split("\n").filter(Boolean));
}

function check(career: Record<string, Json>): string[] {
  const problems: string[] = [];
  const files = tracked();
  const tracks = new Set((JSON.parse(readFileSync(path.join(APP, "Tracks/tracks.json"), "utf8")) as { id: string }[]).map((t) => t.id));
  tracks.add("your-dubplate"); // cut in the studio (chapter 8)
  const scenes = new Set((JSON.parse(readFileSync(path.join(APP, "Story/scenes.json"), "utf8")) as { id: string }[]).map((s) => s.id));
  const lessons = career.lessons as Record<string, Json>[];
  const nights = career.nights as Record<string, Json>[];
  const chapters = career.chapters as Record<string, Json>[];
  if (lessons.length !== 22) problems.push(`${lessons.length} lessons, expected 22`);
  if (nights.length !== 20) problems.push(`${nights.length} nights, expected 20`);
  if (chapters.length !== 12) problems.push(`${chapters.length} chapters, expected 12`);

  const voice = (v: Json, where: string) => {
    if (typeof v === "string" && !files.has(`App/Lessons/${v}.m4a`)) problems.push(`${where}: no App/Lessons/${v}.m4a`);
  };
  const record = (r: Json, where: string) => {
    if (typeof r === "string" && !tracks.has(r)) problems.push(`${where}: record "${r}" is not in tracks.json`);
  };
  const room = (r: Json, where: string) => {
    if (typeof r === "string" && !files.has(`App/Art/room-${r}.jpg`)) problems.push(`${where}: no App/Art/room-${r}.jpg`);
  };
  const records = (list: Json, where: string) => { if (Array.isArray(list)) list.forEach((r) => record(r, where)); };

  for (const l of lessons) {
    const desk = l.desk as Record<string, Json>;
    room(desk.room, `lesson ${l.id}`);
    for (const key of ["records", "bag", "partnerBag"]) records(desk[key], `lesson ${l.id} ${key}`);
    for (const s of l.steps as Record<string, Json>[]) {
      for (const key of ["voice", "missVoice", "lateVoice"]) voice(s[key], `lesson ${l.id}`);
      const goal = s.goal as Record<string, Json>;
      if (goal.type === "recordLoaded") record(goal.id, `lesson ${l.id} goal`);
      if (goal.type === "pickRecord") records(goal.good, `lesson ${l.id} goal`);
    }
  }
  voice((career.handsOff as Record<string, Json>).voice, "handsOff");
  for (const lines of Object.values(career.nightLines as Record<string, Json[]>)) for (const x of lines) voice((x as Record<string, Json>).voice, "night lines");
  for (const nt of nights) {
    room(nt.room, `night ${nt.id}`);
    for (const key of ["records", "bag", "hot", "encoreWith", "partnerBag"]) records(nt[key], `night ${nt.id} ${key}`);
    record(nt.lastRecord, `night ${nt.id} lastRecord`);
    for (const r of nt.requests as Record<string, Json>[]) { record(r.record, `night ${nt.id} request`); voice(r.voice, `night ${nt.id} request`); }
    for (const lines of Object.values(nt.lines as Record<string, Json[]>)) for (const x of lines) voice((x as Record<string, Json>).voice, `night ${nt.id} lines`);
  }
  const lessonIds = new Set(lessons.map((l) => l.id)), nightIds = new Set(nights.map((nt) => nt.id));
  for (const c of chapters) {
    for (const s of c.steps as Record<string, Json>[]) {
      for (const sc of s.screens as Record<string, Json>[]) {
        if (sc.type === "story" && !scenes.has(sc.id as string)) problems.push(`chapter ${c.number}: no scene "${sc.id}"`);
        if (sc.type === "lesson" && !lessonIds.has(sc.id as string)) problems.push(`chapter ${c.number}: no lesson "${sc.id}"`);
        if (sc.type === "night" && !nightIds.has(sc.id as string)) problems.push(`chapter ${c.number}: no night "${sc.id}"`);
      }
    }
  }

  // The same record lists as tools/check-nights.py reads them (a second, independent reading).
  const src = readFileSync(path.join(APP, "Night.swift"), "utf8");
  const ids = (body: string, key: string) => {
    const m = new RegExp(`${key}: \\[([^\\]]*)\\]`).exec(body);
    return m && m[1].trim() ? m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean) : [];
  };
  for (const m of src.matchAll(/static let (\w+) = NightInfo\(id: "([^"]+)"([\s\S]*?)(?=\n    static let |\n    \/\/\/ |\n\}\n)/g)) {
    const nt = nights.find((x) => x.id === m[2]);
    if (!nt) { problems.push(`night ${m[2]} is in Night.swift but not in Nights.all`); continue; }
    for (const key of ["records", "bag", "hot", "partnerBag"]) {
      const theirs = ids(m[3], key), ours = (nt[key] as string[] | null) ?? [];
      if (JSON.stringify(theirs) !== JSON.stringify(ours)) problems.push(`night ${m[2]} ${key}: ${JSON.stringify(ours)} here, ${JSON.stringify(theirs)} by check-nights.py's reading`);
    }
  }
  return problems;
}

// MARK: - Main

const career = build();
const problems = check(career);
const text = JSON.stringify(career, null, 1) + "\n";
if (problems.length) {
  for (const p of problems) console.error(`content: ${p}`);
  process.exit(1);
}
if (process.argv.includes("--check")) {
  const now = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (now !== text) {
    console.error("content: web/content/career.json is not what the Swift says. Run `node web/tools/content.ts` and commit it.");
    process.exit(1);
  }
  console.log("content: career.json matches the Swift");
} else {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  const c = career as Record<string, Json[]>;
  console.log(`content: ${c.chapters.length} chapters, ${c.lessons.length} lessons, ${c.nights.length} nights -> ${path.relative(ROOT, OUT)} (${text.length} bytes)`);
}
