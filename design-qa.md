# Scene-first 2.5D visual QA

Date: 2026-09-20

## References

- Public gameplay screenshot used for spatial reference: <https://static.trueplookpanya.com/cmsblog/1712/73712/thumb_file.jpg>
- Local prototype reviewed in the Codex browser: <http://127.0.0.1:5180/?test=scene>

The reference was used for composition and spatial relationships only. The
implementation does not copy its code or artwork.

## Target observations

- The shop floor is the primary screen rather than a dashboard with a large
  outer card.
- Counters and their level/action plaques sit against the rear wall.
- Customer lanes project from the counter toward the foreground, with people
  visibly occupying those lanes.
- The manager's collection path is a rear corridor between the wall and the
  counter.
- UI plaques use the same visual language as the world: compact, attached,
  bordered, and image-contained.

## Final review

Final result: passed

- The dashboard shell, duplicate footer feedback, and detached side panels are
  hidden in the scene-first presentation; the first viewport is the live shop.
- Location-specific authored backdrops now provide the rear wall, coffee
  machines, shelves, and counter cabinetry; the empty floor remains available
  as the front-floor layer for live queues and actors.
- React controls and Phaser actors share `#sceneWorld`; the wall, manager
  route, counter belt, queue rugs, and customer flow use one normalized layout.
- The queue rug begins at the counter's front band and expands toward the
  foreground. The manager route remains above it, between the rear wall and
  counter.
- Entry and exit signs remain on the left and right edges without covering the
  queue rugs or counter controls.
- Recipe icons, counter icons, authored rear-scene art, and other visible scene
  images were measured inside their parent/clip bounds; all 12 sampled image
  nodes were loaded and contained.
- Visual checks were repeated at 981x817 desktop, 844x390 landscape,
  667x375 landscape, and 390x844 portrait. The document stayed within the
  viewport; portrait uses the intended internal world scroll.
- The browser console contained no warning or error entries during the final
  review.

## Remaining fidelity boundary

The reference has a denser, fully modeled 3D asset set. This prototype keeps
its existing project-owned raster assets and Phaser actors, so the match is
intentional at the composition, layer, plaque, queue, and interaction level
rather than pixel-for-pixel artwork.
