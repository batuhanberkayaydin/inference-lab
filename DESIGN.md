---
name: Inference Lab
description: A daylight analytical workbench for inference measurements.
colors:
  navy: "#172b3a"
  copper: "#c94f2c"
  copper-hover: "#ad4022"
  canvas: "#f5f6f8"
  paper: "#fff"
  ink: "#253744"
  body-ink: "#263844"
  muted: "#647480"
  line: "#e4e8ed"
  field-line: "#d9e0e6"
  focus-ring: "#7094f1"
  nav-active: "#344c5d"
  nav-hover: "#243c4d"
  nav-text: "#b7c7d3"
  segment-bg: "#f0f3f6"
  button-hover: "#f1f4f6"
  model-blue: "#3f6eeb"
  model-copper: "#dd693b"
  model-teal: "#0b8b78"
  model-lilac: "#9772cc"
  success-ink: "#34745b"
  success-bg: "#eef7f1"
  running-ink: "#4769aa"
  running-bg: "#eef3fc"
  warning-ink: "#996628"
  warning-bg: "#fff7e9"
  failure-ink: "#aa4b3c"
  failure-bg: "#fbeeea"
typography:
  display:
    fontFamily: 'Manrope, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "55px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.04em"
  headline:
    fontFamily: 'Manrope, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "29px"
    fontWeight: 750
    lineHeight: 1.35
    letterSpacing: "-0.035em"
  title:
    fontFamily: 'Manrope, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 750
    letterSpacing: "-0.02em"
  body:
    fontFamily: 'Manrope, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
  label:
    fontFamily: 'Manrope, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 650
  control:
    fontFamily: 'Manrope, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 650
  metric:
    fontFamily: 'Manrope, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 650
  code:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
    fontSize: "13px"
    lineHeight: 1.85
rounded:
  badge: "4px"
  segment: "5px"
  control: "7px"
  prompt: "8px"
  model: "9px"
  panel: "12px"
spacing:
  label-gap: "7px"
  control-gap: "8px"
  grid-gap: "12px"
  settings-gap: "16px"
  section-inset: "23px"
  desktop-gutter: "34px"
  mobile-gutter: "15px"
components:
  button-primary:
    backgroundColor: "{colors.copper}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-primary-hover:
    backgroundColor: "{colors.copper-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  navigation:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.nav-text}"
    width: "218px"
    padding: "28px 18px 0"
  navigation-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  mode-control:
    backgroundColor: "{colors.segment-bg}"
    rounded: "{rounded.control}"
    padding: "3px"
  status-completed:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-ink}"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.panel}"
  model-selector:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.model}"
    padding: "13px 14px"
  prompt-editor:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.prompt}"
  metric-table:
    typography: "{typography.metric}"
---

# Design System: Inference Lab

## Overview

**Creative North Star: "The Daylight Analytical Workbench"**

Inference Lab places careful measurement inside a calm, compact workspace. A persistent navy navigation frame anchors white preparation and result panels; copper identifies the primary action. Borders, restrained corners, and clear grouping establish hierarchy without decorative imagery.

Manrope carries both interface copy and measurements. Stable model colors connect selection, traces, tables, and saved reports, while tabular figures make changing values comparable. Dense results stay in tables; editable inputs have their own space. These choices record the implemented direction delegated by the user.

**Key Characteristics:**
- Persistent navy navigation and paper-white panels.
- Copper primary action; four stable model identities.
- Self-hosted Manrope and tabular measurement figures.
- Compact desktop grids and labeled mobile navigation.

## Colors

The palette combines a deep navy frame, warm copper action, and cool paper surfaces; frontmatter values are normative.

### Primary
- **Workbench Navy:** navigation, loading screen, and login story provide the structural anchor.
- **Action Copper:** primary buttons and text action hover; the darker hover token provides feedback.

### Secondary
- **Model Blue, Model Copper, Model Teal, Model Lilac:** the four configured comparison identities. Selection uses a thin identity border and a very pale tint; plots and legends retain the same color. These are data identities rather than action accents.

### Neutral
- **Canvas and Paper:** the page backdrop and panels, fields, or raised mode selection.
- **Ink and Body Ink:** field/control text and the root body respectively; preserve their source distinction.
- **Muted:** secondary explanation and metadata. Line and Field Line define panel separators and editable boundaries.
- **Navigation Text, Active, and Hover:** maintain readable states within the navy frame.
- **Focus Ring:** a visible blue outline for keyboard interaction.
- **Success, Running, Warning, and Failure:** paired text/background colors for labeled state badges; always accompany color with status text.

**The Model Identity Rule.** Carry each model’s configured color consistently through selectors, chart traces, legends, tables, and saved reports; color identifies the model, not the winner.

## Typography

**Display and Body Font:** self-hosted Manrope, with the frontmatter system fallback stack. Latin and extended Latin files use font-display swap and variable weights (200–800), supporting Turkish interface text.

**Code Font:** the frontmatter monospace stack for raw output and configuration.

Manrope provides a compact, legible analytical voice. Page headlines use a stronger weight and tight tracking; helper copy and metadata are quieter. The hierarchy is contextual rather than a fixed mathematical scale.

- **Display:** login story only; reduces at tablet widths.
- **Headline:** page title; reduces to (24px) on mobile.
- **Title:** section headings, with implemented contextual headings (14–16px).
- **Body:** base interface type; descriptive copy generally uses (12–14px) with generous line height. Request lane/time and saved-test metadata use the incumbent contextual (12px) size.
- **Label and Control:** fields and ordinary buttons; compact toolbars use smaller variants.
- **Metric:** emphasized values with smaller units; tabular figures also appear in chart axes and progress.
- **Code:** wrapping request output with the monospace stack.

**The Measurement Figures Rule.** Use tabular numerals for axes, metric values, progress, and request counts; keep units and provenance visibly attached to their measurements.

## Layout

At the reviewed desktop size (1440 × 1000), a fixed navy sidebar (218px) and white topbar (62px) frame a main region with the desktop gutter token. Main content is capped at (1550px). Four model columns and two prompt columns share the grid gap token. Setup content uses a distinct inset and launch strip; results sit below in their own panel. Chart and progress form a two-column result overview.

Actual CSS breakpoints are (1600px), (1150px), (900px), and (680px). The sidebar grows at large widths and narrows at intermediate widths; model selection becomes two columns at (900px), and the result overview stacks. At (680px) and below, navigation becomes a sticky two-row header (102px), with a brand row and six visible labeled controls (48px height): five workspace destinations and settings. Main content uses the mobile gutter token, prompts stack, shared settings wrap, and the launch button fills its strip.

At the reviewed mobile size (390 × 844), wide measurement tables scroll within their container. The shared overview chart measures its container and matches the SVG viewBox width to that measurement (minimum 280px), with plot heights of (270px) on desktop and (250px) at the mobile breakpoint. Data-driven axes adapt time-tick density to the measured width; tabular axis labels use (12px) on desktop and (13px) on mobile. The empty chart icon remains explicitly constrained to (24 × 24px).

The separate timed-test page stacks flat preparation, result, and history panels with a (24px) gap. Its full-width model field precedes a four-column pacing grid, which becomes two columns at (900px) and one at (680px). Results use a textual summary and expandable vertical request rows without charts or tables. Request checks wrap below the metrics at (900px); on mobile the endpoint, launch controls, and history rows stack, and panel padding reduces from (24px) to (18px).

## Elevation & Depth

Borders and tonal differences supply the main depth. White workspace panels have no box shadow. The selected mode receives a small shadow; export menus and feedback toasts float above the workspace. Shadow and motion values are carried in the sidecar, outside the portable token schema.

**The Flat Workspace Rule.** Preparation and result panels remain flat; reserve shadows for selected mode controls and transient overlays.

Buttons transition background, color, and borders over (0.16s). Progress uses a transform transition (0.25s) from the left edge; the spinner rotates over (1.1s). These motion treatments communicate state rather than decorate the interface.

## Shapes

Rounded rectangles structure the workspace. Panels use the panel radius, model selectors the model radius, prompt groups the prompt radius, and buttons and fields the control radius. Smaller badges and segmented options use the smaller steps. Thin neutral borders define fields, rows, and containers. Circular dots identify models and state; pill geometry is reserved for switch tracks rather than panel styling.

## Components

- **Primary and secondary buttons:** compact text-and-icon controls with the same shape. Primary uses copper and white; secondary uses white with a neutral border. Hover adjusts fill/border. Disabled buttons reduce opacity (0.48) and use a not-allowed cursor. Keyboard focus uses an outline (3px) offset (3px).
- **Fields:** white fill, neutral stroke, copper caret, and a blue border on focus. Labels remain visible above editable content. Textareas resize vertically.
- **Navigation:** persistent navy frame; a pale navy active fill, white active text, and warm active icon. Mobile keeps visible short labels below icons and the implemented control height.
- **Mode control:** pale segmented track, white selected option, compact shadow. Unselected hover darkens the track locally; the benchmark and result phase controls use different densities.
- **Overview chart:** one shared chart for live results and saved reports. A labeled metric selector switches between cumulative provider output tokens and total output divided by elapsed model-phase time. Stable model colors and distinct line patterns connect toggleable legend buttons to traces; hidden models use a struck-through label and pressed state. A pointer cursor and keyboard-operable time range inspector expose per-model values, units, and sample times. Unknown measurements remain gaps or explicit dashes; the final point agrees with the completed phase summary.
- **Mode explanation:** a pale preparation panel pairs a question-led heading with model/input counts, plain-language behavior, and labeled request-sequence lanes. Single request, simultaneous inputs, and the two-phase comparison each show their request totals and result interpretation. A separate scheduling explanation distinguishes model execution order from input concurrency. At (900px), headings and lanes stack; request chips wrap within the panel.
- **Status badges:** compact rounded labels with a dot and semantic text/background pair. Completed, running/queued, warning/partial/stopped, and failed/cancelled states remain distinguishable by text.
- **Panels:** flat white, a thin line border, and rounded corners. Setup has separate header/content/launch regions; results use their own padded content region.
- **Model selectors:** a tinted model symbol, checkbox, name, model ID, and connection/type metadata. Selection strengthens the identity border and applies a light identity tint; use the configured color consistently.
- **Prompt editors:** a pale header with input number and context selector, a roomy white textarea, and a compact count/provenance footer. Focus sits inside the editor boundary.
- **Metric tables:** neutral header rows, thin horizontal dividers, emphasized tabular values, smaller units, and stable model indicators. Unknown values stay explicit; provenance belongs next to the data. Contain mobile overflow inside the table wrapper.
- **Timed-test preparation:** ordinary labeled controls set one registered model, independent lanes, dispatch duration, response pause, and timeout. The explanation states that each lane waits after its own response before sending again. A segmented choice switches between text preparation and a monospace JSON/curl body editor; validation exposes the prepared JSON in a pale expandable preview. curl is not executed: only its JSON body and timeout are read, while command headers and API keys are excluded. The selected registered provider and key remain the request destination. The copper launch action sits beside an explicit demo checkbox.
- **Timed-test request log:** a textual verdict and guard counts precede newest-first, paginated expandable request rows. Each row separates request/lane/time metadata, tabular response duration and provider token speed, HTTP status, guard result, and retry attempts using the existing labeled badges. Unknown metrics remain dashes; missing guard headers remain unknown rather than pass. A warning identifies demo responses, durations, and guard results as synthetic. Expanded rows preserve errors and empty-answer notices, show guard version, policy, and output-token metadata, and load wrapping monospace answer text with optional reasoning in a nested disclosure. Reasoning alone does not count as a nonempty user answer.
- **Timed-test history:** fine separators divide reopenable saved-test rows with a name, contextual date/success/retry metadata, and a labeled status; the same result log supports current and saved tests.

## Do's and Don'ts

### Do:
- Do preserve model colors across every comparison surface.
- Do keep mobile navigation labels visible and its controls at the implemented 48px height.
- Do match chart width to its measured container and retain readable, data-driven axis labels.
- Do put wide comparison tables inside their own horizontal scroll container.
- Do distinguish synthetic demonstrations, unknown measurements, and actual provider counts visibly.
- Do reuse the self-hosted font, focus treatment, panel borders, and compact spacing.

### Don't:
- Don’t treat model colors as success or failure indicators.
- Don’t compress the desktop chart unchanged into the mobile layout.
- Don’t substitute token estimates for measured provider usage.
- Don’t introduce decorative raster imagery or shadows on every panel.
- Don’t animate progress by changing layout width; use the existing transform scale.

## Answer comparison

Each input has a collapsible prompt and open model answer columns using the established identity colors. Answer text wraps at 13px with 1.85 line height; status, 12px token/time metadata and copy controls remain separate. Output regions scroll independently without moving the reader automatically. Four desktop columns become two below 1150px and one below 680px. Stream responses update incrementally; normal responses appear together when complete. Failed and stopped requests preserve partial text beside the error. The same component is used in live results and saved reports.
