# Dashboard design direction

Applied reference: [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md), read on 2026-09-16. This is an implementation in the existing Vue application, not a new prototype or backend redesign.

## Product and task

PriestessBot is an operator console for composing Agents, routing IM messages, and diagnosing model/tool executions. Keep the existing logo image and PriestessBot name. Preserve configuration preview/revision checks and all current resource permissions.

## Tokens

User refinement: keep the new UX and restore the earlier yellow/gold visual style, including a warm light navigation surface. The logo is unchanged.

- Parchment `#F5F1E8`: application canvas.
- Ivory `#FFFDF7`: working surface.
- Ink `#2D281F`: primary content.
- Sand `#F2ECDF`: navigation.
- Gold `#B58A38`: primary action and selection accent, matching the earlier theme.
- Linen `#E5DCCB`: structural separators.

Typography: Avenir Next for Latin names and interface controls, PingFang SC/Hiragino Sans GB for Chinese. Use a 12/13/14/16/22/28 scale. Reserve monospace for actual code, IDs and payloads. Body fields and operational labels remain sans-serif. Use 6–10 px corner radii, limited shadows and visible keyboard focus.

## Layout alternatives and review

A single long form keeps all fields in document order but makes model choice, resource mounting and execution budgets difficult to locate. The selected object workbench gives each task a stable place without discarding drafts when switching sections.

```
Long-form alternative         Selected workbench
navigation | object list      navigation | page / connection status
           | all fields                  | preview / apply controls
           | all resources               | object list | object identity
           | all budgets                 |             | task tabs
                                         |             | active editor
```

All form content is left aligned. Agent uses four sections; IM uses connection, route and identity sections. The route number is meaningful priority, so numbering is retained there. Execution details use an ordered timeline with payload disclosure, not expanded JSON everywhere.

The existing logo anchors a warm navigation frame. Gold indicates the current location and primary actions; ivory working surfaces keep dense forms readable. Avoid decorative gradients, generic large hero headlines, repeated title cards and invented monitoring data. Configuration filenames belong in optional source details, not the primary editing hierarchy.

## Verification

Inspect desktop and narrow/mobile breakpoints. Verify tab keyboard controls, draft preservation, form validation, previews, route ordering, resource navigation, execution filters and payload expansion. Inspect the packaged app, not only source or a static mock. Keep runtime labels truthful: a healthy HTTP service does not imply that every IM connection is online.
