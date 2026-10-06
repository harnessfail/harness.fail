# Contributing

Contributions are accepted via pull requests. If you would rather not edit JSON, open an issue with the source and the details instead, and the maintainer will turn it into a row.

Everything on the page comes from the files in `data/`. The site in `docs/` is generated from them; never edited manually.

- `data/record.json`: the issue classes and the issues
- `data/matrix.json`: the requirements, the scores, the per-harness notes and the scoring history
- `data/shifts.json`: the landscape shifts

## What qualifies as an issue

An issue is a case where an AI agent harness did not hold a boundary it was supposed to hold. It goes in the class whose boundary failed; each class has its definition on [the page](https://harness.fail/#the-record).

An issue needs:
- **A public source.** Primary sources are preferred: an advisory, a CVE record, a vendor announcement, or the researcher's own write-up. Press coverage is fine when no first-hand account is public. Vendor-contributed articles are not sources.
- **The affected harness**, or harnesses.
- **The date it was first publicly disclosed.**
- **One factual sentence on what failed.**
- **The version that fixed it**, if it was fixed and a source says so.

## Choosing the class

Each class sits at the point where the boundary broke, on the path from the agent being installed to its action taking effect:

```
install ─── open ─── instruct ─── connect ─── read ─── decide ─── act
```

The table lists the classes in the order the page does: outward from the harness's decision, then Act.

| Where it broke | Class | The question to ask |
|---|---|---|
| **Decide:** the harness rules on an action | Scaffolding collapse | Would the issue disappear if the harness enforced exactly what it documents? |
| **Read:** the agent takes in task content | Indirect prompt injection | Did material it legitimately processed steer it into acting for the attacker? |
| **Connect:** the agent gains tools | Tool poisoning | Was the tool channel hostile: its descriptions, its results, or a configuration write it steered the agent into? |
| **Instruct:** standing instructions load | Agent instruction-file injection | Were the instruction files the agent trusts the injection vector? |
| **Open:** the agent gets a workspace | Ambient activation | Did the agent or its editor act on the project before anyone asked or granted trust? |
| **Install:** the code you run arrives | Supply-chain compromise | Was the harness the payload, the weapon or the foothold of a compromised release or package? |
| **Act:** the action executes | Excessive agency | With no attacker and a benign instruction, did the agent do damage through its own error? |

These are positions, not steps. An issue is filed under the boundary that failed, not the path the attack took to reach it: when a harness's own check failed, the issue is Scaffolding collapse however the attacker got there, so a trust dialog bypassed to run code on open is not also Ambient activation.

## Adding an issue

Add an object to `issues` in `data/record.json`:

| Field | Required | What goes in it |
|---|---|---|
| `id` | yes | Lowercase and hyphenated, unique, e.g. `claude-code-dns-exfiltration` |
| `class` | yes | The id of the class whose boundary failed |
| `title` | yes | A short name, or the name the finders gave it |
| `url` | yes | The source, `https` only; `null` only when there is no public source |
| `credit` | yes | Who found or reported it, with any CVE ids, e.g. `CVE-2025-55284, Johann Rehberger` |
| `cves` | with CVEs | The CVE ids, the same set as in `credit` |
| `date` | yes | First public disclosure: `YYYY-MM-DD`, or `YYYY-MM` or `YYYY` when that is all the source gives |
| `harnesses` | yes | The affected harnesses, named as elsewhere in the file |
| `fail` | yes | One or two factual sentences, past tense, on what failed |
| `fix` | see below | `{ "status": …, "text": … }` |
| `featured` | no | Left to the maintainer |

Text fields may contain Markdown links, `https` only.

### Fix status

Never guess a fix. If no source states one, the status is `unknown`.

- `fixed`: a source names the fixing version or date.
- `partial`: fixed in some of the affected harnesses or paths, not all.
- `disputed`: a fix or the issue itself is contested between the finder and the vendor.
- `declined`: the vendor declined to treat it as a vulnerability.
- `unknown`: no source states a fix. The text may be `null`, or say what is known, e.g. `— (reported April 2025; fix status unanswered at publication)`.
- `n/a`: nothing to fix, such as a research demonstration.

`text` is required for every status except `unknown` and `n/a`. Within a class, either every issue carries `fix` or none does.

## Suggesting a landscape shift

A shift is a release or announcement that changes where file-access policy lives, who decides, or which way it fails; a new feature alone is not one. The maintainer curates the list. To suggest a shift, open a pull request that adds an object to `shifts` in `data/shifts.json`, with `date` (`YYYY-MM-DD`), `title`, `url` (the primary source, `https` only) and `text`.

## Disputing a matrix score

Each harness in `data/matrix.json` has a mark per requirement and a note on what the marks rest on. Marks are `y` (● yes, documented), `p` (◐ partial, or documented gaps), `n` (○ no), `u` (? undocumented) and `na` (— not applicable).

A score cites public sources only: vendor documentation, public source code, the project's own issue tracker, and security advisories, primary sources preferred. `u` means no authoritative statement was found either way; inference is not scoring. To dispute a score, change the mark and the note together, cite the source in the note, and add a dated entry to `history` saying what changed.

## Corrections and removal requests

A correction fixes a fact: a date, a version, a source, a harness, or the wording of a sentence. Open an issue or a pull request with the source that shows the right fact.

A removal request is not a correction. Rows record public disclosures and are not taken down on request. A row is removed only when a valid legal demand requires it.

## Running the checks

Node.js 22 or later (`.nvmrc` pins the version the site is built with).

```sh
npm install     # also enables the pre-commit hook
npm run check   # validates data/ and the formatting
npm run build   # writes docs/
```

With the hook enabled, a commit that touches `data/`, `src/index.html`, `src/assets/`, `build.mjs` or `package-lock.json` runs the checks, rebuilds the site, stages `docs/` into the same commit, and sets `updated` to today in the data files it changes. Pull requests without a rebuilt `docs/` are fine; the maintainer rebuilds on merge.

## License

Contributions are accepted under [CC BY 4.0](LICENSE), the license of the page and the data.
