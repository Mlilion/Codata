# Third-party components and redistribution

Codata's own code is licensed under Apache-2.0. Third-party components retain
their original licenses; the root license does not override them.

## Bundled source and assets

| Component | Source / version | License and attribution |
| --- | --- | --- |
| Chinese agency agents | [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh); see bundled package metadata | MIT; copyright Michael Sitarzewski and jnMetaCode. Preserve [the original license](backend/app/data/agency-agents-zh/LICENSE). |
| Data analyst plugin | Anthropic; see [plugin metadata](backend/app/data/plugins/data/.claude-plugin/plugin.json) | Apache-2.0; preserve [the bundled license](backend/app/data/plugins/data/LICENSE) and upstream attribution. |
| Skill creator | Adapted from Anthropic's skill-creator; see [adaptation notes](backend/app/data/skills/skill-creator/SKILL.md) | Apache-2.0; preserve [the bundled license](backend/app/data/skills/skill-creator/LICENSE.txt). |
| Apache ECharts | [5.4.3](https://github.com/apache/echarts/tree/5.4.3), report renderer asset | Apache-2.0; preserve the asset's embedded notices and [upstream NOTICE](backend/app/report/assets/NOTICE). |
| Node.js and npm | [Node.js 22.22.0](https://nodejs.org/dist/v22.22.0/), downloaded for desktop packaging | Preserve the distribution's LICENSE and npm's nested license files. The download script retains them; do not distribute only the executable. |

Other built-in skills, templates, fonts, icons, and visual assets also need
provenance checks before a release. This inventory is not evidence that every
asset has been legally cleared.

## Package dependencies

JavaScript and Rust versions are recorded in their lockfiles. Python development
requirements and release requirements are maintained separately; record the
resolved environment for the actual release, not only development minimums.

Before distributing an installer:

1. Review the licenses of the exact installed production dependencies and native
   binaries that enter the installer, including transitive dependencies.
2. Retain required copyright notices, license texts, and source-offer or
   relinking information where applicable. A dependency used only during build
   time is not automatically present in the shipped binary.
3. For dual-licensed dependencies, record the license option used. For LGPL
   components, assess the actual linking/distribution arrangement rather than
   treating every lockfile entry as a release blocker.
4. Do not bundle dependencies marked proprietary, UNLICENSED, or having no grant
   of redistribution rights without explicit authorization. PPTX visual preview
   is not included because its previous renderer did not grant such rights.
5. Ship this notice file, the root LICENSE, and the bundled component notices
   with the backend resources. Inspect the final installer, not just the source
   tree.

Public availability on a package registry does not grant redistribution rights.
Code ownership, employer authorization, trademark rights, and permission for
third-party screenshots or branding require separate confirmation.
