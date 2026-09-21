/**
 * Shared normalized coordinates for the side-on 2.5D shop.
 *
 * React uses these values as CSS custom properties and Phaser uses the same
 * values when it places the raster actors. Keeping the anchors here prevents
 * the background, interactive counter controls and moving actors from
 * quietly drifting into separate coordinate systems again.
 */
export const sceneLayout = {
  counter: {
    centerY: 0.46,
    width: 0.25
  },
  barista: {
    centerY: 0.34
  },
  manager: {
    // The rear collection lane sits above the counter front, not across the
    // cabinet face in the authored location backdrops.
    routeY: 0.36
  },
  customer: {
    entryX: 0.02,
    entryY: 0.64,
    exitX: 1.08,
    exitY: 0.7,
    // Leave a small physical gap after the counter plaque so the queue rug
    // reads as a floor extension instead of another card laid over it.
    rugTop: 0.6,
    rugBottom: 0.97
  }
} as const;

export type SceneLayout = typeof sceneLayout;
