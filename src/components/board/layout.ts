export const LANE_W = 148;
export const COL_MIN = 252;

/** Same grid for the rail and for every lane, so the columns line up. */
export const gridCols = (stages: number) => `${LANE_W}px repeat(${stages}, minmax(${COL_MIN}px, 1fr))`;
export const boardMinWidth = (stages: number) => LANE_W + stages * COL_MIN;
