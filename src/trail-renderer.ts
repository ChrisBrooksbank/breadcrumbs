import type { Breadcrumb } from '@/types';

const WALKED_COLOR = '#9ca3af'; // grey
const REMAINING_COLOR = '#3b82f6'; // blue
const POSITION_DOT_COLOR = '#1d4ed8'; // dark blue (on-route)
const POSITION_DOT_OFF_ROUTE_COLOR = '#dc2626'; // red (off-route)
const LANDMARK_COLOR = '#8b5cf6'; // purple
const TRAIL_LINE_WIDTH = 3;
const METERS_PER_DEGREE_LAT = 111_319.5;
const CATMULL_ROM_TENSION = 0.5;

/** Minimum number of upcoming breadcrumbs the auto-zoom must keep visible. */
const MIN_VISIBLE_UPCOMING = 3;

/** EMA smoothing factor for zoom transitions (0 = no smoothing, 1 = instant). */
const ZOOM_SMOOTH_ALPHA = 0.12;

interface TrailRendererOptions {
    canvas: HTMLCanvasElement;
}

export interface Point {
    x: number;
    y: number;
}

interface BoundingBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/**
 * Project a lat/lng breadcrumb to local x/y coordinates in meters
 * using equirectangular projection centered on the given origin.
 *
 * @param b - The breadcrumb to project
 * @param origin - The reference (center) breadcrumb
 * @returns x/y in meters
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
        // Control points derived from Catmull-Rom → Bezier mapping:
        //   cp1 = p1 + (p2 - p0) * alpha / 6
        //   cp2 = p2 - (p3 - p1) * alpha / 6
        const cp1x = p1.x + ((p2.x - p0.x) * alpha) / 6;
        const cp1y = p1.y + ((p2.y - p0.y) * alpha) / 6;
        const cp2x = p2.x - ((p3.x - p1.x) * alpha) / 6;
        const cp2y = p2.y - ((p3.y - p1.y) * alpha) / 6;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
}

/**
 * Compute the bounding box of a set of local-coordinate points.
 * Returns null if the array is empty.
 */
export function computeBoundingBox(points: Point[]): BoundingBox | null {
    if (points.length === 0) return null;

    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;

    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    return { minX, maxX, minY, maxY };
}

/**
 * Compute the bounding box for auto-zoom: considers only the remaining route
 * (from currentIndex onward) plus the current position.
 *
 * If fewer than MIN_VISIBLE_UPCOMING remaining breadcrumbs exist, the box is
 * expanded to include walked points near the end so the view is never too tight.
 *
 * @param projected     - All trail breadcrumbs projected to local coordinates
 * @param currentIndex  - Index of the next target breadcrumb
 * @param currentPt     - Current user position in local coordinates (or null)
 * @returns Bounding box in local coordinates, or null if nothing to show
 */
export function computeAutoZoomBoundingBox(
    projected: Point[],
    currentIndex: number,
    currentPt: Point | null
): BoundingBox | null {
    const remaining = projected.slice(currentIndex);

    // Ensure at least MIN_VISIBLE_UPCOMING points are in the view.
    // If there are fewer remaining breadcrumbs, include walked ones (nearest first).
    const minPoints: Point[] = [...remaining];
    if (minPoints.length < MIN_VISIBLE_UPCOMING) {
        const needed = MIN_VISIBLE_UPCOMING - minPoints.length;
        const walkStart = Math.max(0, currentIndex - needed);
        const walked = projected.slice(walkStart, currentIndex);
        minPoints.push(...walked);
    }

    const allPoints: Point[] = currentPt ? [...minPoints, currentPt] : minPoints;
    return computeBoundingBox(allPoints);
}

export interface TrailRenderState {
    /** All breadcrumbs in order (walked + remaining). */
    trail: Breadcrumb[];
    /** Index of the next target breadcrumb (i.e. how many have been walked). */
    currentIndex: number;
    /** Current user position (may not be on the trail). */
    currentPosition: Breadcrumb | null;
    /**
     * Compass heading in degrees (0 = north, 90 = east). When provided, the canvas
     * is rotated by -compassHeading so the direction of travel always points up.
     * If omitted or null, no rotation is applied (north-up).
     */
    compassHeading?: number | null;
    /**
     * Whether the user is currently off the trail (> 30m from nearest segment).
     * When true, the position dot is rendered in red instead of blue.
     */
    isOffRoute?: boolean;
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
    // Smooth zoom state: track the previous frame's scale and offsets for EMA interpolation
    let smoothScale: number | null = null;
    let smoothOffsetX: number | null = null;
    let smoothOffsetY: number | null = null;

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
            smoothOffsetX = null;
            smoothOffsetY = null;
        }

        // Always apply DPR scaling so that all draw calls use CSS-pixel coordinates.
        // We must re-apply after any resize (which resets the transform) and also
        // when the canvas was already the right size (e.g. first render with no resize).
        if (canvas.width !== lastPhysicalWidth || canvas.height !== lastPhysicalHeight) {
            ctx.scale(dpr, dpr);
            lastPhysicalWidth = canvas.width;
            lastPhysicalHeight = canvas.height;
        }

        const width = cssWidth;
        const height = cssHeight;

        ctx.clearRect(0, 0, width, height);

        if (trail.length === 0) return;

        // Heading-up rotation: rotate canvas so direction of travel points up.
        // Rotate by -compassHeading degrees around the canvas centre.
        const heading = state.compassHeading ?? 0;
        const cx = width / 2;
        const cy = height / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((-heading * Math.PI) / 180);
        ctx.translate(-cx, -cy);

        // Use first breadcrumb as projection origin
        const origin = trail[0];

        // Project all trail points
        const projected = trail.map(b => projectToLocal(b, origin));

        // Also project the current position if available
        const currentPt = currentPosition ? projectToLocal(currentPosition, origin) : null;

        // Auto-zoom: compute bounding box from remaining route + current position only.
        // This zooms in as the user approaches the end, and ensures MIN_VISIBLE_UPCOMING crumbs.
        const bbox = computeAutoZoomBoundingBox(projected, currentIndex, currentPt);
        if (!bbox) {
            ctx.restore();
            return;
        }

        // Build a transform: local meters → canvas pixels, with 15% padding
        const PADDING_FACTOR = 0.15;
        const padX = (bbox.maxX - bbox.minX) * PADDING_FACTOR || 20;
        const padY = (bbox.maxY - bbox.minY) * PADDING_FACTOR || 20;

        const rangeX = bbox.maxX - bbox.minX + 2 * padX;
        const rangeY = bbox.maxY - bbox.minY + 2 * padY;

        const scaleX = width / rangeX;
        const scaleY = height / rangeY;
        const targetScale = Math.min(scaleX, scaleY);
        const targetOffsetX = width / 2 - ((bbox.minX + bbox.maxX) / 2) * targetScale;
        const targetOffsetY = height / 2 - ((bbox.minY + bbox.maxY) / 2) * targetScale;

        // Apply EMA smoothing for zoom transitions — avoids jarring jumps
        if (smoothScale === null) {
            // First frame: snap immediately
            smoothScale = targetScale;
            smoothOffsetX = targetOffsetX;
            smoothOffsetY = targetOffsetY;
        } else {
            smoothScale = smoothScale + ZOOM_SMOOTH_ALPHA * (targetScale - smoothScale);
            smoothOffsetX =
                (smoothOffsetX ?? targetOffsetX) +
                ZOOM_SMOOTH_ALPHA * (targetOffsetX - (smoothOffsetX ?? targetOffsetX));
            smoothOffsetY =
                (smoothOffsetY ?? targetOffsetY) +
                ZOOM_SMOOTH_ALPHA * (targetOffsetY - (smoothOffsetY ?? targetOffsetY));
        }

        const scale = smoothScale;
        const offsetX = smoothOffsetX ?? targetOffsetX;
        const offsetY = smoothOffsetY ?? targetOffsetY;

        function toCanvas(p: Point): Point {
            return {
                x: p.x * scale + offsetX,
                y: p.y * scale + offsetY,
            };
        }

        // --- Draw walked portion (grey) using Catmull-Rom spline ---
        // Walked: from trail[0] up to currentIndex (inclusive)
        if (currentIndex > 0) {
            const walkedPts = projected
                .slice(0, Math.min(currentIndex + 1, projected.length))
                .map(toCanvas);

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
        // Remaining: from trail[currentIndex] to end
        if (currentIndex < trail.length) {
            const remainingPts = projected.slice(currentIndex).map(toCanvas);

            ctx.beginPath();
            ctx.strokeStyle = REMAINING_COLOR;
            ctx.lineWidth = TRAIL_LINE_WIDTH;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.moveTo(remainingPts[0].x, remainingPts[0].y);
            drawCatmullRom(ctx, remainingPts);
            ctx.stroke();
        }

        // --- Draw current position dot ---
        if (currentPt) {
            const cp = toCanvas(currentPt);
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = state.isOffRoute ? POSITION_DOT_OFF_ROUTE_COLOR : POSITION_DOT_COLOR;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // --- Draw next target waypoint ---
        if (currentIndex < projected.length) {
            const tp = toCanvas(projected[currentIndex]);
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#f59e0b'; // amber
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // --- Draw landmark markers (purple diamonds with labels) ---
        for (let i = 0; i < trail.length; i++) {
            if (!trail[i].label) continue;
            const lp = toCanvas(projected[i]);
            const size = 7;
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

            // Draw label text above the diamond
            ctx.font = '11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = LANDMARK_COLOR;
            ctx.fillText(trail[i].label!, lp.x, lp.y - size - 4);
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
