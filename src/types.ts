export interface Breadcrumb {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: number;
    label?: string;
    /**
     * True when GPS was lost between the previous crumb and this one and the walker moved
     * far in the meantime, so the segment leading to this crumb is a straight-line guess.
     */
    gap?: boolean;
}

export interface Session {
    id: string;
    startedAt: number;
    breadcrumbs: Breadcrumb[];
}

export interface SavedRoute {
    id: string;
    name: string;
    date: number;
    distance: number;
    breadcrumbCount: number;
    breadcrumbs: Breadcrumb[];
    landmarkCount?: number;
    /** Saved automatically when a walk finished; the oldest of these are dropped past a cap. */
    auto?: boolean;
}
