# harness.fail

A record of security issues that AI agent harnesses failed to prevent.

## Contents

- **The record:** issues where a harness did not hold the boundary it was supposed to hold, sorted into classes by the boundary that failed. Each row names its source, the affected harness and, where there is one, the fix.
  - **Scaffolding collapse:** the harness's own code fails to enforce a boundary it declares.
  - **Indirect prompt injection:** instructions hidden in material the agent reads steer the agent.
  - **Tool poisoning:** a hostile tool reaches the agent through its descriptions or results.
  - **Agent instruction-file injection:** the instruction files the agent trusts are the injection vector.
  - **Ambient activation:** opening a folder is enough; the agent acts before any trust is granted.
  - **Supply-chain compromise:** a compromised release or package makes the harness its payload, its weapon or its foothold.
  - **Excessive agency:** no attacker, no injection; the agent does damage with the reach it was given.
- **The matrix:** the capabilities a harness needs to enforce a file-access policy, written as abstract requirements, with each harness scored against them from its own documentation, source code, issue tracker and security advisories.
- **Landscape shifts:** directional changes in agent harnesses, and in the operating systems they run on, that move where file-access policy lives, who decides, or which way it fails.

Scaffolding collapse and Ambient activation are named on this site: they have no counterpart in OWASP or MITRE ATLAS. The other names come from the literature, credited on the page.

## Published

- <https://harness.fail>: the page
- <https://harness.fail/record.json>: the issue classes and the issues
- <https://harness.fail/matrix.json>: the requirements, the scores, the per-harness notes and the scoring history

Both JSON files are licensed like the page, so they can be reused with attribution.

## Contributing

Open a pull request to add an issue or dispute a matrix score. Issues go in `data/record.json`; scores and notes in `data/matrix.json`. The site in `docs/` is generated from these files, so leave it out of the pull request.

An issue needs a source, the affected harness, the date it was first disclosed, and one factual sentence on what failed. If it was fixed, name the version that fixed it. Primary sources are preferred: an advisory, a CVE record, a vendor announcement, or the researcher's own write-up. Press coverage is fine when no first-hand account is public.

## License

[CC BY 4.0](LICENSE). Contributions are accepted under the same license.

## Maintained by

Peter Seprus, the author of [agentaccess.txt](https://agentaccesstxt.org/), a proposed convention that addresses part of this problem — one mitigation among several, not the fix for everything on this site.
