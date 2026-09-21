# Figma 2.5D visual QA

Date: 2026-09-21

## References

- Figma source node: `13:3` — `VIEW / Home · v2 · 2.5D integrated`.
- Figma world node: `22:155` — `SCENE-00 / World · 2.5D`.
- Source export captured from the connected Figma file: `1280 × 720`.
- Browser implementation: <http://127.0.0.1:5173/?test=visual-review>
- Repository rendering asset: `assets/figma/world-2.5d.png`.

The Figma export is used only as the authored visual layer. Live React controls,
runtime values, focus states, dialogs, and Phaser synchronization remain real
DOM/runtime behavior; the exported PNG does not replace those interactions.

## Final review

Final result: passed

- The authored wall, menu board, four counters, queue rugs, baristas,
  customers, manager, vault, brand plaque, and boost plaque match the Figma
  source composition through the repository Figma exports.
- The recipe wall uses the eight-slot Figma visual baseline: four unlocked
  recipe slots and four locked slots. The browser currently exposes five live
  recipe detail actions; the remaining visual slots are not treated as
  implemented business recipes.
- The source asset is opaque and fills the scene coordinate system; the
  apparent pale margin in the in-app browser capture was verified as that
  browser's DPR screenshot presentation. A Chrome capture at the same target
  frame fills the viewport, and DOM geometry reports the image and world at
  the same bounds.
- Real UI checks covered recipe detail, station picker expansion, counter
  detail, Escape restoration, keyboard traversal, and the visible
  营业中/已打烊 switch. Focus outlines reveal otherwise-transparent hit areas.
- Responsive checks covered 844 × 390 landscape, 667 × 375 landscape, and
  390 × 844 portrait. The document had no page-level horizontal overflow;
  portrait keeps the intended internal world scroll.
- Representative semantic targets remain at least 44 CSS pixels in the
  compact viewport checks. The accessibility tree exposed the scene
  description, balance/pending/manager values, queue capacity, recipe
  actions, station picker, dialogs, and business switch.
- A fresh browser tab reported no console warnings or errors after the Phaser
  renderer was constrained to Canvas for this authored-background mode.

## Evidence boundary

This is a browser-baseline review, not a physical-device certification. Touch
was exercised through browser pointer input and the compact hit-target
geometry; a physical iOS/Android device was not available. The accessibility
evidence is the browser accessibility tree, not a separate VoiceOver or
TalkBack session. The Figma file itself was used as the source of exported
assets; this task did not edit prototype connector wiring in Figma.

The product and parameter documents still label Q1 economy values as a
candidate/draft baseline. This visual pass does not promote those values to a
user-confirmed product decision.
