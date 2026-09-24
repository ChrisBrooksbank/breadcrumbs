import type { Breadcrumb } from '@/types';

const WALKED_COLOR = '#9ca3af'; // grey
const REMAINING_COLOR = '#3b82f6'; // blue
const POSITION_DOT_COLOR = '#1d4ed8'; // dark blue (on-route)
const POSITION_DOT_OFF_ROUTE_COLOR = '#dc2626'; // red (off-route)
const LANDMARK_COLOR = '#8b5cf6'; // purple
const GAP_COLOR = '#f97316'; // orange: a stretch recorded without GPS
const GUIDE_COLOR = '#dc2626'; // red: the way back onto the route
const TRAIL_LINE_WIDTH = 4;
const METERS_PER_DEGREE_LAT = 111_319.5;
const CATMULL_ROM_TENSION = 0.5;

/** Where the user is drawn, as a fraction of the canvas height from the top (ahead is up). */
const ANCHOR_Y = 0.72;
/** Auto zoom shows this much of the path still to walk. */
const AUTO_LOOKAHEAD_METERS = 150;
/** Auto zoom never shows less than this much ahead of the user. */
const MIN_RANGE_METERS = 40;
const EDGE_MARGIN_PX = 24;
const MIN_SCALE = 0.15; // px per metre
const MAX_SCALE = 8;

/** EMA smoothing factor for zoom transitions (0 = no smoothing, 1 = instant). */
const ZOOM_SMOOTH_ALPHA = 0.12;

/** Manual zoom steps: how many metres ahead of the user reach the top of the view. */
export const ZOOM_RANGES_METERS = [40, 80, 160, 320];

interface TrailRendererOptions {
    canvas: HTMLCanvasElement;
}

export interface Point {
    x: number;
    y: number;
}

/**
 * Project a lat/lng breadcrumb to local x/y coordinates in meters
 * using equirectangular projection centered on the given origin.
 * x is east; y is DOWN the screen, so north is negative.
 */
export function projectToLocal(b: Breadcrumb, origin: Breadcrumb): Point {
    const latMid = toRadians((b.lat + origin.lat) / 2);
    const x = (b.lng - origin.lng) * METERS_PER_DEGREE_LAT * Math.cos(latMid);
    const y = -(b.lat - origin.lat) * METERS_PER_DEGREE_LAT; // negate so north is up
    return { x, y };
}

function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

/**
 * Rotate a local point (x east, y south) into a heading-up view (x right, y down), the same
 * transform as `ctx.rotate(-heading)`. Straight ahead ends up with negative y.
 */
export function rotateToHeadingUp(p: Point, headingDegrees: number): Point {
    const phi = toRadians(-headingDegrees);
    return {
        x: p.x * Math.cos(phi) - p.y * Math.sin(phi),
        y: p.x * Math.sin(phi) + p.y * Math.cos(phi),
    };
}

/**
 * The part of the remaining path worth fitting on screen: from the target crumb onward until
 * `lookaheadMeters` of path have been covered (the crumb that crosses the limit is included).
 */
export function lookaheadPoints(
    local: Point[],
    currentIndex: number,
    lookaheadMeters = AUTO_LOOKAHEAD_METERS
): Point[] {
    if (currentIndex >= local.length) return [];
    const result: Point[] = [local[currentIndex]];
    let covered = Math.hypot(local[currentIndex].x, local[currentIndex].y);
    for (let i = currentIndex + 1; i < local.length && covered < lookaheadMeters; i++) {
        covered += Math.hypot(local[i].x - local[i - 1].x, local[i].y - local[i - 1].y);
        result.push(local[i]);
    }
    return result;
}

interface ViewScaleInput {
    /** Points to keep in view, already rotated into the heading-up view, relative to the user. */
    points: Point[];
    width: number;
    height: number;
    /** Manual zoom: metres ahead that reach the top of the view. Omit for auto. */
    zoomRangeMeters?: number | null;
}

/** Pixels per metre for the view. */
export function computeViewScale({
    points,
    width,
    height,
    zoomRangeMeters,
}: ViewScaleInput): number {
    const aheadPx = Math.max(height * ANCHOR_Y - EDGE_MARGIN_PX, 1);
    const sidePx = Math.max(width / 2 - EDGE_MARGIN_PX, 1);

    let scale: number;
    if (zoomRangeMeters != null && zoomRangeMeters > 0) {
        scale = aheadPx / zoomRangeMeters;
    } else {
        let forward = MIN_RANGE_METERS;
        let sideways = 10;
        for (const p of points) {
            forward = Math.max(forward, -p.y);
            sideways = Math.max(sideways, Math.abs(p.x));
        }
        scale = Math.min(aheadPx / forward, sidePx / sideways);
    }
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Draw a Catmull-Rom spline through the given canvas-space points onto ctx.
 * Uses the four-point parametric formula: for each interior segment [P1, P2],
 * P0 and P3 are the neighbours used as implicit control points.
 *
 * Endpoint clamping: the first and last points are duplicated so the spline
 * passes exactly through them.
 *
 * @param ctx   - 2D rendering context (path must already be started with moveTo)
 * @param pts   - Array of canvas-space points to interpolate through
 * @param alpha - Tension (0 = uniform, 0.5 = centripetal). Defaults to CATMULL_ROM_TENSION.
 */
export function drawCatmullRom(
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    alpha = CATMULL_ROM_TENSION
): void {
    if (pts.length < 2) return;
    if (pts.length === 2) {
        ctx.lineTo(pts[1].x, pts[1].y);
        return;
    }

    // Clamp: duplicate first and last points so the spline starts and ends exactly there
    const p = [pts[0], ...pts, pts[pts.length - 1]];

    for (let i = 1; i < p.length - 2; i++) {
        const p0 = p[i - 1];
        const p1 = p[i];
        const p2 = p[i + 1];
        const p3 = p[i + 2];

        // Catmull-Rom with cubic Bezier conversion
        //   cp1 = p1 + (p2 - p0) * alpha / 6
        //   cp2 = p2 - (p3 - p1) * alpha / 6
        const cp1x = p1.x + ((p2.x - p0.x) * alpha) / 6;
        const cp1y = p1.y + ((p2.y - p0.y) * alpha) / 6;
        const cp2x = p2.x - ((p3.x - p1.x) * alpha) / 6;
        const cp2y = p2.y - ((p3.y - p1.y) * alpha) / 6;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
}

export interface TrailRenderState {
    /** All breadcrumbs in order (walked + remaining). */
    trail: Breadcrumb[];
    /** Index of the next target breadcrumb (i.e. how many have been walked). */
    currentIndex: number;
    /** Current user position (may not be on the trail). */
    currentPosition: Breadcrumb | null;
    /**
     * Heading in degrees (0 = north, 90 = east). The view is rotated so this direction points
     * up and the user stays fixed on screen. If omitted or null the view is north-up.
     */
    compassHeading?: number | null;
    /**
     * Whether the user is currently off the trail (> 30m from nearest segment).
     * When true, the position dot is rendered in red instead of blue.
     */
    isOffRoute?: boolean;
    /** Manual zoom (metres ahead reaching the top of the view); omit or null for auto zoom. */
    zoomRangeMeters?: number | null;
    /**
     * Indices k of trail segments (trail[k] to trail[k + 1]) recorded across a GPS gap;
     * drawn as dashed straight lines because the real path there is unknown.
     */
    gapSegments?: readonly number[];
    /** When off the route, the nearest point of it: a dashed guide line is drawn to it. */
    guidePoint?: Breadcrumb | null;
}

export interface TrailRenderer {
    /**
     * Queue a render for the next animation frame. If a frame is already
     * pending, the state is replaced (only the latest state is drawn).
     * This throttles redraws to the display refresh rate (~60fps).
     */
    render(state: TrailRenderState): void;
}

export function createTrailRenderer({ canvas }: TrailRendererOptions): TrailRenderer {
    // Smooth zoom state: the previous frame's scale, for EMA interpolation
    let smoothScale: number | null = null;

    // RAF throttle state
    let pendingState: TrailRenderState | null = null;
    let rafScheduled = false;

    // Track the last known physical canvas size so we can detect resize and re-apply DPR scale.
    let lastPhysicalWidth = 0;
    let lastPhysicalHeight = 0;

    function drawFrame(state: TrailRenderState): void {
        const { trail, currentIndex, currentPosition } = state;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Handle high-DPI screens: scale the backing store by devicePixelRatio so
        // each CSS pixel maps to dpr physical pixels, giving crisp rendering on
        // Retina / high-DPI displays.
        const dpr = window.devicePixelRatio ?? 1;
        const cssWidth = canvas.clientWidth;
        const cssHeight = canvas.clientHeight;
        const physW = Math.round(cssWidth * dpr);
        const physH = Math.round(cssHeight * dpr);

        if (canvas.width !== physW || canvas.height !== physH) {
            // Resize the backing store — this resets the 2D context transform.
            canvas.width = physW;
            canvas.height = physH;
            // Reset smooth-zoom state so the new canvas size produces a clean first frame.
            smoothScale = null;
        }

        // Always apply DPR scaling so that all draw calls use CSS-pixel coordinates.
        if (canvas.width !== lastPhysicalWidth || canvas.height !== lastPhysicalHeight) {
            ctx.scale(dpr, dpr);
            lastPhysicalWidth = canvas.width;
            lastPhysicalHeight = canvas.height;
        }

        const width = cssWidth;
        const height = cssHeight;

        ctx.clearRect(0, 0, width, height);

        if (trail.length === 0) return;

        // The user is the fixed point of the view. Without a fix, stand on the target crumb.
        const anchor = currentPosition ?? trail[Math.min(currentIndex, trail.length - 1)];
        const heading = state.compassHeading ?? 0;
        const local = trail.map(b => projectToLocal(b, anchor));

        const ahead = lookaheadPoints(local, currentIndex).map(p => rotateToHeadingUp(p, heading));
        const targetScale = computeViewScale({
            points: ahead,
            width,
            height,
            zoomRangeMeters: state.zoomRangeMeters,
        });
        smoothScale =
            smoothScale === null
                ? targetScale
                : smoothScale + ZOOM_SMOOTH_ALPHA * (targetScale - smoothScale);
        const scale = smoothScale;

        const toView = (p: Point): Point => ({ x: p.x * scale, y: p.y * scale });
        const viewPoints = local.map(toView);

        // Heading-up: put the user at the anchor and rotate the world about them
        ctx.save();
        ctx.translate(width / 2, height * ANCHOR_Y);
        ctx.rotate((-heading * Math.PI) / 180);

        // --- Draw walked portion (grey) using Catmull-Rom spline ---
        // Everything up to the last crumb the user has reached. The leg they are walking now
        // (last reached crumb -> target) belongs to the route still to go, so it is blue.
        const reached = Math.min(currentIndex, viewPoints.length);
        if (reached > 1) {
            const walkedPts = viewPoints.slice(0, reached);

            ctx.beginPath();
            ctx.strokeStyle = WALKED_COLOR;
            ctx.lineWidth = TRAIL_LINE_WIDTH;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.moveTo(walkedPts[0].x, walkedPts[0].y);
            drawCatmullRom(ctx, walkedPts);
            ctx.stroke();
        }

        // --- Draw remaining portion (blue) using Catmull-Rom spline ---
        if (currentIndex < trail.length) {
            const remainingPts = viewPoints.slice(Math.max(currentIndex - 1, 0));

            ctx.beginPath();
            ctx.strokeStyle = REMAINING_COLOR;
            ctx.lineWidth = TRAIL_LINE_WIDTH;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.moveTo(remainingPts[0].x, remainingPts[0].y);
            drawCatmullRom(ctx, remainingPts);
            ctx.stroke();
        }

        // --- Stretches recorded without GPS: dashed straight lines over the top ---
        const gaps = (state.gapSegments ?? []).filter(k => k >= 0 && k + 1 < viewPoints.length);
        if (gaps.length > 0) {
            ctx.strokeStyle = GAP_COLOR;
            ctx.lineWidth = TRAIL_LINE_WIDTH;
            ctx.lineCap = 'butt';
            ctx.setLineDash([10, 8]);
            for (const k of gaps) {
                ctx.beginPath();
                ctx.moveTo(viewPoints[k].x, viewPoints[k].y);
                ctx.lineTo(viewPoints[k + 1].x, viewPoints[k + 1].y);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // --- Off the route: dashed guide from the user to the nearest point of it ---
        if (state.guidePoint) {
            const guide = toView(projectToLocal(state.guidePoint, anchor));
            ctx.beginPath();
            ctx.strokeStyle = GUIDE_COLOR;
            ctx.lineWidth = 3;
            ctx.lineCap = 'butt';
            ctx.setLineDash([6, 6]);
            ctx.moveTo(0, 0);
            ctx.lineTo(guide.x, guide.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // --- Draw next target waypoint ---
        if (currentIndex < viewPoints.length) {
            const tp = viewPoints[currentIndex];
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#f59e0b'; // amber
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // --- Draw landmark markers (purple diamonds with upright labels) ---
        for (let i = 0; i < trail.length; i++) {
            if (!trail[i].label) continue;
            const lp = viewPoints[i];
            const size = 9;
            ctx.beginPath();
            ctx.moveTo(lp.x, lp.y - size);
            ctx.lineTo(lp.x + size, lp.y);
            ctx.lineTo(lp.x, lp.y + size);
            ctx.lineTo(lp.x - size, lp.y);
            ctx.closePath();
            ctx.fillStyle = LANDMARK_COLOR;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Counter-rotate so the label reads upright whichever way the view is turned
            ctx.save();
            ctx.translate(lp.x, lp.y);
            ctx.rotate((heading * Math.PI) / 180);
            ctx.font = 'bold 14px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 5;
            ctx.fillStyle = LANDMARK_COLOR;
            ctx.fillText(trail[i].label!, 0, -size - 6);
            ctx.restore();
        }

        // --- Draw the user last, on top, always at the fixed anchor ---
        if (currentPosition) {
            ctx.beginPath();
            ctx.arc(0, 0, 9, 0, Math.PI * 2);
            ctx.fillStyle = state.isOffRoute ? POSITION_DOT_OFF_ROUTE_COLOR : POSITION_DOT_COLOR;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // Restore canvas transform (undo heading-up rotation)
        ctx.restore();
    }

    function render(state: TrailRenderState): void {
        // Store the latest state — intermediate states between frames are dropped.
        pendingState = state;

        if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(() => {
                rafScheduled = false;
                const s = pendingState;
                pendingState = null;
                if (s !== null) drawFrame(s);
            });
        }
    }

    return { render };
}
