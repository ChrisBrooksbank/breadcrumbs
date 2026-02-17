export interface Breadcrumb {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: number;
    label?: string;
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
}
