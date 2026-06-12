---
name: html-page-generator
description: Generate polished, self-contained HTML pages. Use this skill whenever the user asks to create an HTML page, single-file website, landing page, static webpage, marketing page, portfolio page, documentation page, dashboard mockup, interactive demo, or wants content turned into a shareable .html file. Prefer this skill even if the user only says “做个页面”, “生成网页”, “写个 HTML”, or asks for a visual web deliverable without naming a framework.
tags: [网页生成, HTML, 前端设计]
expert: true
---

# HTML Page Generator

Use this skill to create complete, attractive, self-contained HTML pages that users can open directly in a browser or share as a single `.html` file.

## Core workflow

1. **Clarify only when necessary**
   - If the page goal, audience, or core content is missing, ask a short question.
   - If enough information exists, proceed and make sensible choices.
   - For visual style, choose a clear direction instead of producing a generic template.

2. **Create a self-contained file**
   - Put HTML, CSS, and JavaScript in one `.html` file unless the user requests a multi-file project.
   - Avoid external runtime dependencies unless they are necessary and allowed.
   - Prefer inline SVG, CSS effects, and vanilla JavaScript for portability.
   - Use CDN fonts/icons only when internet access in the final page is acceptable; otherwise use system-safe fallbacks.

3. **Design before code**
   Decide the page’s:
   - Purpose: landing page, portfolio, article, dashboard, product page, event page, etc.
   - Audience and tone: professional, playful, luxury, editorial, technical, educational, futuristic, minimal, etc.
   - Content hierarchy: headline, key message, sections, calls to action, supporting details.
   - Visual system: typography, color palette, spacing rhythm, grid, imagery style, motion.

4. **Implement production-quality HTML**
   Include:
   - Semantic structure: `header`, `main`, `section`, `article`, `nav`, `footer` where appropriate.
   - Responsive layout for mobile, tablet, and desktop.
   - Accessible labels, readable contrast, keyboard-friendly controls, and meaningful alt text where images exist.
   - CSS variables for colors, spacing, shadows, and radii.
   - Thoughtful micro-interactions: hover states, focus states, reveal animations, or small interactive components when useful.
   - Clean code comments only where they help future editing.

5. **Validate and present**
   - Save the output under an `output/` directory when creating files in a workspace.
   - Name files clearly, e.g. `output/product-landing.html`, `output/portfolio.html`.
   - Open or present the final file to the user with the appropriate preview/presentation tool when available.
   - If possible, quickly inspect the file for obvious syntax, layout, and missing-content issues.

## Design standards

Avoid default-looking AI pages. Do not rely on:
- Overused purple/blue gradients unless the brand calls for them.
- Generic centered hero + three cards + rounded buttons without a reason.
- Plain Arial/Inter-only styling.
- Identical spacing and card shapes everywhere.
- Placeholder-heavy content when the user supplied enough context.

Instead, make specific choices:
- Use a distinct visual concept tied to the page topic.
- Create contrast through scale, rhythm, asymmetry, texture, illustration, or strong editorial layout.
- Treat typography as a design element: expressive headings, readable body text, consistent line length.
- Add atmosphere with gradients, patterns, borders, shadows, masks, or custom SVG motifs where appropriate.
- Keep minimal designs precise: spacing, alignment, and copy matter more than decorative effects.

## Output requirements

When generating the final HTML file, ensure it has:

```html
<!doctype html>
<html lang="zh-CN"> <!-- or appropriate language -->
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>...</title>
  <meta name="description" content="..." />
  <style>
    /* Complete responsive CSS */
  </style>
</head>
<body>
  <!-- Semantic page content -->
  <script>
    // Optional vanilla JS interactions
  </script>
</body>
</html>
```

Prefer Chinese `lang="zh-CN"` for Chinese pages, English `lang="en"` for English pages, and match the user’s language for visible copy.

## Common page patterns

### Landing page
Include:
- Strong hero with value proposition.
- Clear call to action.
- Benefits or features.
- Social proof, process, pricing, FAQ, or contact section as relevant.

### Portfolio or personal site
Include:
- Personal positioning.
- Featured work or skills.
- Timeline, services, or case studies.
- Contact section.
- Visual personality that matches the person’s field.

### Article or documentation page
Include:
- Readable content width.
- Table of contents when useful.
- Clear headings and code/content blocks if needed.
- Print-friendly or distraction-free styling where appropriate.

### Dashboard or data mockup
Include:
- Cards, charts, tables, filters, and trend indicators.
- Use inline SVG/CSS charts if no real data file is provided.
- Make clear when numbers are sample data.

## Interaction guidelines

Use JavaScript sparingly and purposefully:
- Mobile navigation toggle.
- Tabs, accordions, filters, calculators, reveal-on-scroll.
- Theme toggle only if it fits the request.

Do not add heavy frameworks for a simple page. If the user requests React/Vue or complex state, use a frontend/web artifact workflow instead of this single-file HTML workflow.

## File safety

- Do not overwrite an existing user file without confirmation.
- Do not modify source data files; create a new output HTML file.
- Keep generated assets embedded or placed in a separate output directory if multi-file output is requested.

## Example prompts this skill should handle

- “帮我生成一个咖啡店官网 HTML 页面。”
- “把这段产品介绍做成一个单页落地页。”
- “创建一个能直接打开的 portfolio.html。”
- “做一个静态数据看板页面，不用后端。”
- “写一个活动邀请函网页，风格高级一点。”
